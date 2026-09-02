import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => {
  const { getTestCookieJar } = await import('../helpers/cookie-jar')
  return { cookies: () => getTestCookieJar() }
})

import { CUSTOMER_SESSION_COOKIE } from '@/lib/auth/sessions'
import { getRequest, jsonPost, primeCsrf, readEnvelope, uniqueIp } from '../helpers/auth-requests'
import { resetTestCookieJar } from '../helpers/cookie-jar'
import { cleanupAccounts, createTestCustomer, trackCustomer } from '../helpers/accounts'

/**
 * Customer authentication (Doc 10 §3, Doc 23 REL-M1-T01, Doc 24 §E.1).
 *
 * Drives the real route handlers against the real database with real
 * iron-session encryption. The cookie jar stands in for a browser.
 */

async function register(body: Record<string, unknown>, ip = uniqueIp()) {
  const { POST } = await import('@/app/api/v1/auth/register/route')
  return POST(jsonPost(body, { ip }))
}

async function login(body: Record<string, unknown>, ip = uniqueIp()) {
  const { POST } = await import('@/app/api/v1/auth/login/route')
  return POST(jsonPost(body, { ip }))
}

async function me() {
  const { GET } = await import('@/app/api/v1/auth/me/route')
  return GET(getRequest())
}

async function logout() {
  const { POST } = await import('@/app/api/v1/auth/logout/route')
  return POST(jsonPost({}))
}

beforeEach(async () => {
  resetTestCookieJar()
  await primeCsrf()
})

afterAll(async () => {
  await cleanupAccounts()
})

describe('registration', () => {
  it('creates an account and signs the customer in', async () => {
    const email = `reg-${Date.now()}@example.test`
    const response = await register({
      email,
      password: 'a-good-password',
      fullName: 'Ahmed Mohamed',
    })

    expect(response.status).toBe(201)
    const body = await readEnvelope<{ email: string; fullName: string }>(response)
    expect(body.data?.email).toBe(email)

    // A session cookie was issued, so the customer is signed in immediately.
    const { getTestCookieJar } = await import('../helpers/cookie-jar')
    expect(getTestCookieJar().has(CUSTOMER_SESSION_COOKIE)).toBe(true)

    const account = await import('@/modules/customers/customers.repository')
    const created = await account.findByEmail(email)
    if (created) trackCustomer({ id: created.id, email, password: 'a-good-password' })
  })

  it('never returns a password or password hash', async () => {
    const response = await register({
      email: `noleak-${Date.now()}@example.test`,
      password: 'a-good-password',
      fullName: 'No Leak',
    })
    const raw = JSON.stringify(await response.json())

    expect(raw).not.toContain('a-good-password')
    expect(raw).not.toContain('passwordHash')
    expect(raw).not.toContain('password_hash')
    expect(raw).not.toContain('$2a$')
    expect(raw).not.toContain('$2b$')
  })

  it('rejects a duplicate email address', async () => {
    const existing = trackCustomer(await createTestCustomer())
    const response = await register({
      email: existing.email,
      password: 'another-password',
      fullName: 'Impostor',
    })

    expect(response.status).toBe(400)
    const body = await readEnvelope(response)
    expect(body.error?.code).toBe('VALIDATION_ERROR')
  })

  it('rejects a weak password', async () => {
    const response = await register({
      email: `weak-${Date.now()}@example.test`,
      password: 'short',
      fullName: 'Weak Password',
    })
    expect(response.status).toBe(400)
  })

  it('ignores attempts to mass-assign server-managed fields', async () => {
    const response = await register({
      email: `mass-${Date.now()}@example.test`,
      password: 'a-good-password',
      fullName: 'Mass Assign',
      id: '00000000-0000-4000-8000-000000000000',
      googleId: 'attacker-controlled',
      passwordHash: '$2a$12$attackerchosenhash',
    })

    // Strict schemas reject unknown keys outright (Doc 21 SF-006).
    expect(response.status).toBe(400)
  })
})

describe('login', () => {
  it('signs in with correct credentials', async () => {
    const customer = trackCustomer(await createTestCustomer())
    const response = await login({ email: customer.email, password: customer.password })

    expect(response.status).toBe(200)
    const { getTestCookieJar } = await import('../helpers/cookie-jar')
    expect(getTestCookieJar().has(CUSTOMER_SESSION_COOKIE)).toBe(true)
  })

  it('rejects a wrong password with a generic message', async () => {
    const customer = trackCustomer(await createTestCustomer())
    const response = await login({ email: customer.email, password: 'wrong-password' })

    expect(response.status).toBe(401)
    const body = await readEnvelope(response)
    expect(body.error?.message).toBe('Invalid email or password.')
  })

  it('gives the same message for an unknown address — no account enumeration', async () => {
    const unknown = await login({
      email: `nobody-${Date.now()}@example.test`,
      password: 'whatever-password',
    })
    const customer = trackCustomer(await createTestCustomer())
    const wrongPassword = await login({ email: customer.email, password: 'wrong-password' })

    const [a, b] = await Promise.all([readEnvelope(unknown), readEnvelope(wrongPassword)])
    expect(unknown.status).toBe(wrongPassword.status)
    expect(a.error?.message).toBe(b.error?.message)
  })

  it('does not issue a session on failure', async () => {
    const customer = trackCustomer(await createTestCustomer())
    await login({ email: customer.email, password: 'wrong-password' })

    const { getTestCookieJar } = await import('../helpers/cookie-jar')
    expect(getTestCookieJar().has(CUSTOMER_SESSION_COOKIE)).toBe(false)
  })
})

describe('session', () => {
  it('rejects /me without a session', async () => {
    const response = await me()
    expect(response.status).toBe(401)
    expect((await readEnvelope(response)).error?.code).toBe('UNAUTHORIZED')
  })

  it('returns the signed-in customer’s own profile', async () => {
    const customer = trackCustomer(await createTestCustomer())
    await login({ email: customer.email, password: customer.password })

    const response = await me()
    expect(response.status).toBe(200)
    expect((await readEnvelope<{ email: string }>(response)).data?.email).toBe(customer.email)
  })

  it('never exposes the account id or password hash from /me', async () => {
    const customer = trackCustomer(await createTestCustomer())
    await login({ email: customer.email, password: customer.password })

    const raw = JSON.stringify(await (await me()).json())
    // Doc 10 §3.5 — internal UUIDs are not shared with customers.
    expect(raw).not.toContain(customer.id)
    expect(raw).not.toContain('passwordHash')
  })

  it('logout ends the session', async () => {
    const customer = trackCustomer(await createTestCustomer())
    await login({ email: customer.email, password: customer.password })
    expect((await me()).status).toBe(200)

    const response = await logout()
    expect(response.status).toBe(200)
    expect((await me()).status).toBe(401)
  })

  it('logout is idempotent without a session', async () => {
    expect((await logout()).status).toBe(200)
  })
})

describe('IDOR — cross-customer access', () => {
  it('serves each customer only their own profile', async () => {
    const alice = trackCustomer(await createTestCustomer())
    const bob = trackCustomer(await createTestCustomer())

    // Alice signs in.
    await login({ email: alice.email, password: alice.password })
    const aliceProfile = await readEnvelope<{ email: string }>(await me())
    expect(aliceProfile.data?.email).toBe(alice.email)

    // A different browser signs in as Bob.
    resetTestCookieJar()
    await primeCsrf()
    await login({ email: bob.email, password: bob.password })
    const bobProfile = await readEnvelope<{ email: string }>(await me())

    expect(bobProfile.data?.email).toBe(bob.email)
    expect(bobProfile.data?.email).not.toBe(alice.email)
  })

  it('cannot be redirected to another account by a request field', async () => {
    const alice = trackCustomer(await createTestCustomer())
    const bob = trackCustomer(await createTestCustomer())

    await login({ email: alice.email, password: alice.password })

    // Identity comes from the session; a body field naming Bob has no effect
    // (Doc 19 AC-CUS-010, Doc 24 §M item 4).
    const { GET } = await import('@/app/api/v1/auth/me/route')
    const response = await GET(
      new Request(`https://thefield.eg/api/v1/auth/me?customerId=${bob.id}`, {
        headers: { 'x-real-ip': uniqueIp() },
      }),
    )

    expect((await readEnvelope<{ email: string }>(response)).data?.email).toBe(alice.email)
  })

  it('a soft-deleted customer loses access immediately', async () => {
    const customer = trackCustomer(await createTestCustomer())
    await login({ email: customer.email, password: customer.password })
    expect((await me()).status).toBe(200)

    // Soft deletion is the documented mechanism (Doc 03 NFR-DATA-004,
    // Doc 24 §D.6). A hard delete is not even possible here: app_user is
    // granted SELECT, INSERT and UPDATE only.
    const { db } = await import('@/lib/db/client')
    const { customerAccounts } = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')
    await db
      .update(customerAccounts)
      .set({ deletedAt: new Date() })
      .where(eq(customerAccounts.id, customer.id))

    // The cookie is still present and still decrypts — re-reading the account
    // on every request is what closes the door.
    expect((await me()).status).toBe(401)
  })
})
