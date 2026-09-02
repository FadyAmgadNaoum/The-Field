import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => {
  const { getTestCookieJar } = await import('../helpers/cookie-jar')
  return { cookies: () => getTestCookieJar() }
})

import { CSRF_COOKIE } from '@/lib/auth/csrf-constants'
import { ADMIN_SESSION_COOKIE, CUSTOMER_SESSION_COOKIE } from '@/lib/auth/sessions'
import { jsonPost, primeCsrf, readEnvelope, uniqueIp } from '../helpers/auth-requests'
import { getTestCookieJar, resetTestCookieJar } from '../helpers/cookie-jar'
import {
  cleanupAccounts,
  createTestAdmin,
  createTestCustomer,
  trackAdmin,
  trackCustomer,
} from '../helpers/accounts'

/**
 * CSRF (Doc 10 §5.4, Doc 24 §E.4) and authentication rate limiting
 * (Doc 11 §7, Doc 24 §I.6).
 */

async function customerLogin(body: Record<string, unknown>, options = {}) {
  const { POST } = await import('@/app/api/v1/auth/login/route')
  return POST(jsonPost(body, options))
}

async function adminLoginRequest(body: Record<string, unknown>, options = {}) {
  const { POST } = await import('@/app/api/v1/admin/auth/login/route')
  return POST(jsonPost(body, options))
}

beforeEach(async () => {
  resetTestCookieJar()
  await primeCsrf()
})

afterAll(async () => {
  await cleanupAccounts()
})

describe('CSRF protection', () => {
  it('rejects a state-changing request with no CSRF token', async () => {
    const customer = trackCustomer(await createTestCustomer())
    const response = await customerLogin(
      { email: customer.email, password: customer.password },
      { csrf: null },
    )

    expect(response.status).toBe(403)
    expect((await readEnvelope(response)).error?.code).toBe('FORBIDDEN')
  })

  it('rejects a forged token that was never minted by this server', async () => {
    const customer = trackCustomer(await createTestCustomer())
    const response = await customerLogin(
      { email: customer.email, password: customer.password },
      { csrf: 'attacker-value.attacker-signature' },
    )
    expect(response.status).toBe(403)
  })

  it('rejects a token whose value was swapped under a valid signature', async () => {
    const valid = getTestCookieJar().get(CSRF_COOKIE)!.value
    const signature = valid.slice(valid.lastIndexOf('.') + 1)

    const customer = trackCustomer(await createTestCustomer())
    const response = await customerLogin(
      { email: customer.email, password: customer.password },
      { csrf: `different-value.${signature}` },
    )
    expect(response.status).toBe(403)
  })

  it('rejects a validly signed token that does not match the cookie', async () => {
    // A token from another browser session must not work here.
    const { createCsrfToken } = await import('@/lib/auth/csrf')
    const customer = trackCustomer(await createTestCustomer())

    const response = await customerLogin(
      { email: customer.email, password: customer.password },
      { csrf: createCsrfToken() },
    )
    expect(response.status).toBe(403)
  })

  it('does not authenticate when CSRF fails, even with correct credentials', async () => {
    const customer = trackCustomer(await createTestCustomer())
    await customerLogin({ email: customer.email, password: customer.password }, { csrf: null })

    // Holding a session cookie must not make a state change automatically
    // trusted (Doc 24 §E.4).
    expect(getTestCookieJar().has(CUSTOMER_SESSION_COOKIE)).toBe(false)
  })

  it('protects administrator sign-in too', async () => {
    const admin = trackAdmin(await createTestAdmin())
    const response = await adminLoginRequest(
      { email: admin.email, password: admin.password },
      { csrf: null },
    )

    expect(response.status).toBe(403)
    expect(getTestCookieJar().has(ADMIN_SESSION_COOKIE)).toBe(false)
  })

  it('accepts the matching token', async () => {
    const customer = trackCustomer(await createTestCustomer())
    expect(
      (await customerLogin({ email: customer.email, password: customer.password })).status,
    ).toBe(200)
  })
})

describe('content-type enforcement', () => {
  it.each(['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'])(
    'rejects %s — a cross-origin HTML form cannot set application/json',
    async (contentType) => {
      const customer = trackCustomer(await createTestCustomer())
      const response = await customerLogin(
        { email: customer.email, password: customer.password },
        { contentType },
      )
      expect(response.status).toBe(400)
    },
  )

  it('rejects a missing content type', async () => {
    const customer = trackCustomer(await createTestCustomer())
    const response = await customerLogin(
      { email: customer.email, password: customer.password },
      { contentType: null },
    )
    expect(response.status).toBe(400)
  })
})

describe('administrator login rate limiting', () => {
  it('blocks after 5 failures from one address and stays blocked', async () => {
    const admin = trackAdmin(await createTestAdmin())
    const ip = uniqueIp()

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await adminLoginRequest(
        { email: admin.email, password: 'wrong-password' },
        { ip },
      )
      expect(response.status).toBe(401)
    }

    const sixth = await adminLoginRequest(
      { email: admin.email, password: 'wrong-password' },
      { ip },
    )
    expect(sixth.status).toBe(429)
    expect((await readEnvelope(sixth)).error?.code).toBe('RATE_LIMITED')

    // Doc 19 AC-ADM-001 — the lockout holds even with the CORRECT password.
    const withCorrect = await adminLoginRequest(
      { email: admin.email, password: admin.password },
      { ip },
    )
    expect(withCorrect.status).toBe(429)
  })

  it('does not penalise a different address', async () => {
    const admin = trackAdmin(await createTestAdmin())
    const blockedIp = uniqueIp()

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await adminLoginRequest({ email: admin.email, password: 'wrong' }, { ip: blockedIp })
    }

    const response = await adminLoginRequest(
      { email: admin.email, password: admin.password },
      { ip: uniqueIp() },
    )
    expect(response.status).toBe(200)
  })

  it('clears the counter after a successful sign-in', async () => {
    const admin = trackAdmin(await createTestAdmin())
    const ip = uniqueIp()

    await adminLoginRequest({ email: admin.email, password: 'wrong' }, { ip })
    await adminLoginRequest({ email: admin.email, password: 'wrong' }, { ip })
    expect(
      (await adminLoginRequest({ email: admin.email, password: admin.password }, { ip })).status,
    ).toBe(200)

    // The earlier failures must not count toward a later lockout.
    resetTestCookieJar()
    await primeCsrf()
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await adminLoginRequest({ email: admin.email, password: 'wrong' }, { ip })
      expect(response.status).toBe(401)
    }
  })

  it('rate limits before checking credentials, so a block cannot be probed', async () => {
    const admin = trackAdmin(await createTestAdmin())
    const ip = uniqueIp()

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await adminLoginRequest({ email: admin.email, password: 'wrong' }, { ip })
    }

    // An unknown address gets the same 429, revealing nothing.
    const response = await adminLoginRequest(
      { email: `ghost-${Date.now()}@example.test`, password: 'whatever' },
      { ip },
    )
    expect(response.status).toBe(429)
  })
})

describe('customer login rate limiting', () => {
  it('blocks after 5 failures from one address', async () => {
    const customer = trackCustomer(await createTestCustomer())
    const ip = uniqueIp()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        (await customerLogin({ email: customer.email, password: 'wrong' }, { ip })).status,
      ).toBe(401)
    }

    expect((await customerLogin({ email: customer.email, password: 'wrong' }, { ip })).status).toBe(
      429,
    )
  })

  it('bounds attempts against one account across many addresses', async () => {
    // The per-account limiter is what stops a distributed attack on a single
    // mailbox (Doc 24 §I.6).
    const customer = trackCustomer(await createTestCustomer())

    let sawRateLimit = false
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await customerLogin(
        { email: customer.email, password: 'wrong' },
        { ip: uniqueIp() },
      )
      if (response.status === 429) {
        sawRateLimit = true
        break
      }
    }

    expect(sawRateLimit).toBe(true)
  })
})

describe('registration rate limiting', () => {
  it('blocks after 5 registrations from one address', async () => {
    const { POST } = await import('@/app/api/v1/auth/register/route')
    const ip = uniqueIp()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await POST(
        jsonPost(
          {
            email: `bulk-${Date.now()}-${attempt}@example.test`,
            password: 'a-good-password',
            fullName: 'Bulk Registration',
          },
          { ip },
        ),
      )
      expect([201, 400]).toContain(response.status)
    }

    const blocked = await POST(
      jsonPost(
        {
          email: `bulk-final-${Date.now()}@example.test`,
          password: 'a-good-password',
          fullName: 'Bulk Registration',
        },
        { ip },
      ),
    )
    expect(blocked.status).toBe(429)
  })
})
