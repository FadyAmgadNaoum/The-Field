import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => {
  const { getTestCookieJar } = await import('../helpers/cookie-jar')
  return { cookies: () => getTestCookieJar() }
})

import { getTestCookieJar, resetTestCookieJar } from '../helpers/cookie-jar'

/**
 * Cross-instance session compatibility (Doc 23 §1.3, §11.3, REL-M1-T02;
 * Doc 24 §I.2, §E.3).
 *
 * Production runs two PM2 instances behind NGINX with no session affinity, so a
 * customer can be served by instance A on one request and instance B on the
 * next. iron-session encrypts the whole session into the cookie, so any
 * instance holding the same SESSION_SECRET can read it — no shared store, no
 * Redis, no sticky sessions.
 *
 * A second instance is simulated by resetting the module registry and importing
 * the session modules again: a fresh module graph with its own in-process state,
 * exactly like a separate Node process.
 */

const SECRET_A = 'instance-shared-secret-value-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SECRET_B = 'a-completely-different-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

const originalSecret = process.env.SESSION_SECRET

/** Load the session module in a fresh module graph, as another process would. */
async function loadInstance(secret: string) {
  vi.resetModules()
  process.env.SESSION_SECRET = secret
  return import('@/lib/auth/sessions')
}

afterEach(() => {
  process.env.SESSION_SECRET = originalSecret
  vi.resetModules()
})

describe('a session issued by one instance is readable by another', () => {
  it('shares the session when both instances hold the same secret', async () => {
    resetTestCookieJar()

    // Instance A issues the session.
    const instanceA = await loadInstance(SECRET_A)
    const sessionA = await instanceA.getCustomerSessionCookie()
    sessionA.customerId = '11111111-2222-4333-8444-555555555555'
    sessionA.email = 'customer@example.test'
    sessionA.issuedAt = Date.now()
    await sessionA.save()

    const cookie = getTestCookieJar().get('thefield_customer_session')
    expect(cookie?.value).toBeTruthy()

    // Instance B — separate module graph, same secret, same cookie jar (the
    // browser sends the same cookie whichever instance answers).
    const instanceB = await loadInstance(SECRET_A)
    const sessionB = await instanceB.getCustomerSessionCookie()

    expect(sessionB.customerId).toBe('11111111-2222-4333-8444-555555555555')
    expect(sessionB.email).toBe('customer@example.test')
  })

  it('shares administrator sessions across instances too', async () => {
    resetTestCookieJar()

    const instanceA = await loadInstance(SECRET_A)
    const sessionA = await instanceA.getAdminSessionCookie()
    sessionA.adminId = '99999999-2222-4333-8444-555555555555'
    sessionA.roleId = '88888888-2222-4333-8444-555555555555'
    sessionA.issuedAt = Date.now()
    await sessionA.save()

    const instanceB = await loadInstance(SECRET_A)
    const sessionB = await instanceB.getAdminSessionCookie()

    expect(sessionB.adminId).toBe('99999999-2222-4333-8444-555555555555')
  })

  it('holds no session state in process memory', async () => {
    resetTestCookieJar()

    const instanceA = await loadInstance(SECRET_A)
    const sessionA = await instanceA.getCustomerSessionCookie()
    sessionA.customerId = '11111111-2222-4333-8444-555555555555'
    await sessionA.save()

    // Everything needed to rebuild the session is in the cookie. Drop it and a
    // brand new instance sees nothing — proving there is no server-side store
    // that could survive, or diverge between instances.
    const cookie = getTestCookieJar().get('thefield_customer_session')!
    resetTestCookieJar()

    const instanceB = await loadInstance(SECRET_A)
    expect((await instanceB.getCustomerSessionCookie()).customerId).toBeUndefined()

    // Restore the cookie and the same instance reads it back.
    getTestCookieJar().set(cookie.name, cookie.value)
    const instanceC = await loadInstance(SECRET_A)
    expect((await instanceC.getCustomerSessionCookie()).customerId).toBe(
      '11111111-2222-4333-8444-555555555555',
    )
  })
})

describe('secret rotation invalidates every session', () => {
  it('rejects a customer session encrypted with a different secret', async () => {
    resetTestCookieJar()

    const instanceA = await loadInstance(SECRET_A)
    const sessionA = await instanceA.getCustomerSessionCookie()
    sessionA.customerId = '11111111-2222-4333-8444-555555555555'
    await sessionA.save()

    // Doc 10 §2.4 — rotating SESSION_SECRET is the emergency revocation
    // control. It must log everyone out, not fail open.
    const rotated = await loadInstance(SECRET_B)
    expect((await rotated.getCustomerSessionCookie()).customerId).toBeUndefined()
  })

  it('rejects an administrator session encrypted with a different secret', async () => {
    resetTestCookieJar()

    const instanceA = await loadInstance(SECRET_A)
    const sessionA = await instanceA.getAdminSessionCookie()
    sessionA.adminId = '99999999-2222-4333-8444-555555555555'
    await sessionA.save()

    const rotated = await loadInstance(SECRET_B)
    expect((await rotated.getAdminSessionCookie()).adminId).toBeUndefined()
  })

  it('a tampered cookie does not decrypt', async () => {
    resetTestCookieJar()

    const instanceA = await loadInstance(SECRET_A)
    const sessionA = await instanceA.getCustomerSessionCookie()
    sessionA.customerId = '11111111-2222-4333-8444-555555555555'
    await sessionA.save()

    const cookie = getTestCookieJar().get('thefield_customer_session')!
    getTestCookieJar().set(cookie.name, `${cookie.value.slice(0, -4)}AAAA`)

    const instanceB = await loadInstance(SECRET_A)
    expect((await instanceB.getCustomerSessionCookie()).customerId).toBeUndefined()
  })
})

describe('cookie scoping', () => {
  it('uses separate cookie names for administrators and customers', async () => {
    const instance = await loadInstance(SECRET_A)
    expect(instance.ADMIN_SESSION_COOKIE).not.toBe(instance.CUSTOMER_SESSION_COOKIE)
  })

  it('scopes the administrator cookie away from public routes', async () => {
    const instance = await loadInstance(SECRET_A)
    // Doc 10 §2.4 — a public-route issue cannot reach an admin session.
    expect(instance.adminSessionOptions.cookieOptions?.path).toBe('/admin')
    expect(instance.customerSessionOptions.cookieOptions?.path).toBe('/')
  })

  it('marks both session cookies HttpOnly and SameSite=Lax', async () => {
    const instance = await loadInstance(SECRET_A)

    for (const options of [instance.adminSessionOptions, instance.customerSessionOptions]) {
      expect(options.cookieOptions?.httpOnly).toBe(true)
      expect(options.cookieOptions?.sameSite).toBe('lax')
    }
  })

  it('applies the documented session lifetimes', async () => {
    const instance = await loadInstance(SECRET_A)
    // Doc 10 §2.4 (8 hours) and §3.1 (7 days).
    expect(instance.ADMIN_SESSION_MAX_AGE_SECONDS).toBe(60 * 60 * 8)
    expect(instance.CUSTOMER_SESSION_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 7)
  })
})
