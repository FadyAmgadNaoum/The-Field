import { and, desc, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => {
  const { getTestCookieJar } = await import('../helpers/cookie-jar')
  return { cookies: () => getTestCookieJar() }
})

import { db } from '@/lib/db/client'
import { auditLogs } from '@/db/schema'
import { ADMIN_SESSION_COOKIE, CUSTOMER_SESSION_COOKIE } from '@/lib/auth/sessions'
import { getRequest, jsonPost, primeCsrf, readEnvelope, uniqueIp } from '../helpers/auth-requests'
import { getTestCookieJar, resetTestCookieJar } from '../helpers/cookie-jar'
import {
  cleanupAccounts,
  createTestAdmin,
  createTestCustomer,
  trackAdmin,
  trackCustomer,
} from '../helpers/accounts'

/** Administrator authentication (Doc 08 §2, Doc 22 §6.2, M1-T04). */

async function adminLogin(body: Record<string, unknown>, ip = uniqueIp()) {
  const { POST } = await import('@/app/api/v1/admin/auth/login/route')
  return POST(jsonPost(body, { ip }))
}

async function adminMe() {
  const { GET } = await import('@/app/api/v1/admin/auth/me/route')
  return GET(getRequest())
}

async function adminLogout() {
  const { POST } = await import('@/app/api/v1/admin/auth/logout/route')
  return POST(jsonPost({}))
}

async function changePassword(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/v1/admin/auth/change-password/route')
  return POST(jsonPost(body))
}

async function latestAuditAction(adminId: string): Promise<string | undefined> {
  const rows = await db
    .select({ action: auditLogs.action })
    .from(auditLogs)
    .where(eq(auditLogs.adminId, adminId))
    .orderBy(desc(auditLogs.id))
    .limit(1)
  return rows[0]?.action
}

beforeEach(async () => {
  resetTestCookieJar()
  await primeCsrf()
})

afterAll(async () => {
  await cleanupAccounts()
})

describe('administrator sign-in', () => {
  it('signs in with correct credentials and issues a session', async () => {
    const admin = trackAdmin(await createTestAdmin())
    const response = await adminLogin({ email: admin.email, password: admin.password })

    expect(response.status).toBe(200)
    const body = await readEnvelope<{ role: string; email: string }>(response)
    expect(body.data?.role).toBe('admin')
    expect(getTestCookieJar().has(ADMIN_SESSION_COOKIE)).toBe(true)
  })

  it('never returns a password hash', async () => {
    const admin = trackAdmin(await createTestAdmin())
    const raw = JSON.stringify(
      await (await adminLogin({ email: admin.email, password: admin.password })).json(),
    )

    expect(raw).not.toContain(admin.password)
    expect(raw).not.toContain('passwordHash')
    expect(raw).not.toContain('$2a$')
  })

  it('rejects a wrong password generically', async () => {
    const admin = trackAdmin(await createTestAdmin())
    const response = await adminLogin({ email: admin.email, password: 'wrong-password' })

    expect(response.status).toBe(401)
    expect((await readEnvelope(response)).error?.message).toBe('Invalid email or password.')
  })

  it('gives an unknown address the identical response — no enumeration', async () => {
    const unknown = await adminLogin({
      email: `ghost-${Date.now()}@example.test`,
      password: 'whatever',
    })
    const admin = trackAdmin(await createTestAdmin())
    const wrong = await adminLogin({ email: admin.email, password: 'wrong-password' })

    expect(unknown.status).toBe(wrong.status)
    expect((await readEnvelope(unknown)).error?.message).toBe(
      (await readEnvelope(wrong)).error?.message,
    )
  })

  it('refuses a deactivated administrator', async () => {
    const admin = trackAdmin(await createTestAdmin({ isActive: false }))
    const response = await adminLogin({ email: admin.email, password: admin.password })

    expect(response.status).toBe(401)
    expect(getTestCookieJar().has(ADMIN_SESSION_COOKIE)).toBe(false)
  })
})

describe('audit trail', () => {
  it('records a successful sign-in', async () => {
    const admin = trackAdmin(await createTestAdmin())
    await adminLogin({ email: admin.email, password: admin.password })

    expect(await latestAuditAction(admin.id)).toBe('admin_login')
  })

  it('records a failed sign-in', async () => {
    const admin = trackAdmin(await createTestAdmin())
    await adminLogin({ email: admin.email, password: 'wrong-password' })

    expect(await latestAuditAction(admin.id)).toBe('admin_login_failed')
  })

  it('records sign-out', async () => {
    const admin = trackAdmin(await createTestAdmin())
    await adminLogin({ email: admin.email, password: admin.password })
    await adminLogout()

    expect(await latestAuditAction(admin.id)).toBe('admin_logout')
  })

  it('never writes a password into the audit metadata', async () => {
    const admin = trackAdmin(await createTestAdmin({ password: 'super-secret-password' }))
    await adminLogin({ email: admin.email, password: 'super-secret-password' })
    await adminLogin({ email: admin.email, password: 'another-secret-guess' })

    const rows = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(eq(auditLogs.adminId, admin.id))

    const serialised = JSON.stringify(rows)
    expect(serialised).not.toContain('super-secret-password')
    expect(serialised).not.toContain('another-secret-guess')
  })
})

describe('session lifecycle', () => {
  it('rejects /me without a session', async () => {
    expect((await adminMe()).status).toBe(401)
  })

  it('returns the administrator profile and permission set', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await adminLogin({ email: admin.email, password: admin.password })

    const body = await readEnvelope<{ role: string; permissions: string[] }>(await adminMe())
    expect(body.data?.role).toBe('admin')
    expect(body.data?.permissions).toContain('approve_booking')
    expect(body.data?.permissions).not.toContain('manage_admins')
  })

  it('sign-out ends the session', async () => {
    const admin = trackAdmin(await createTestAdmin())
    await adminLogin({ email: admin.email, password: admin.password })
    expect((await adminMe()).status).toBe(200)

    await adminLogout()
    expect((await adminMe()).status).toBe(401)
  })

  it('deactivating an administrator revokes the live session immediately', async () => {
    const admin = trackAdmin(await createTestAdmin())
    await adminLogin({ email: admin.email, password: admin.password })
    expect((await adminMe()).status).toBe(200)

    const { adminUsers } = await import('@/db/schema')
    await db.update(adminUsers).set({ isActive: false }).where(eq(adminUsers.id, admin.id))

    // Doc 19 AC-ADM-004 — effective on the next request, not at cookie expiry.
    expect((await adminMe()).status).toBe(401)
  })

  it('advancing sessions_invalidated_at revokes an existing session', async () => {
    const admin = trackAdmin(await createTestAdmin())
    await adminLogin({ email: admin.email, password: admin.password })
    expect((await adminMe()).status).toBe(200)

    const { adminUsers } = await import('@/db/schema')
    await db
      .update(adminUsers)
      .set({ sessionsInvalidatedAt: new Date(Date.now() + 1000) })
      .where(eq(adminUsers.id, admin.id))

    expect((await adminMe()).status).toBe(401)
  })
})

describe('session isolation between principals', () => {
  it('a customer session cannot authenticate an administrator route', async () => {
    const customer = trackCustomer(await createTestCustomer())
    const { POST } = await import('@/app/api/v1/auth/login/route')
    await POST(jsonPost({ email: customer.email, password: customer.password }))

    expect(getTestCookieJar().has(CUSTOMER_SESSION_COOKIE)).toBe(true)
    // Separate cookie namespaces (Doc 10 §1).
    expect((await adminMe()).status).toBe(401)
  })

  it('an administrator session does not grant a customer identity', async () => {
    const admin = trackAdmin(await createTestAdmin())
    await adminLogin({ email: admin.email, password: admin.password })

    const { GET } = await import('@/app/api/v1/auth/me/route')
    expect((await GET(getRequest())).status).toBe(401)
  })
})

describe('must_change_password enforcement', () => {
  it('reports the flag on sign-in', async () => {
    const admin = trackAdmin(await createTestAdmin({ mustChangePassword: true }))
    const body = await readEnvelope<{ mustChangePassword: boolean }>(
      await adminLogin({ email: admin.email, password: admin.password }),
    )
    expect(body.data?.mustChangePassword).toBe(true)
  })

  it('allows the password to be changed and clears the flag', async () => {
    const admin = trackAdmin(await createTestAdmin({ mustChangePassword: true }))
    await adminLogin({ email: admin.email, password: admin.password })

    const response = await changePassword({
      currentPassword: admin.password,
      newPassword: 'a-brand-new-password',
    })
    expect(response.status).toBe(200)

    // The change invalidates every prior session, including this one.
    expect((await adminMe()).status).toBe(401)

    resetTestCookieJar()
    await primeCsrf()
    const body = await readEnvelope<{ mustChangePassword: boolean }>(
      await adminLogin({ email: admin.email, password: 'a-brand-new-password' }),
    )
    expect(body.data?.mustChangePassword).toBe(false)
  })

  it('rejects a change when the current password is wrong', async () => {
    const admin = trackAdmin(await createTestAdmin())
    await adminLogin({ email: admin.email, password: admin.password })

    const response = await changePassword({
      currentPassword: 'not-the-current-password',
      newPassword: 'a-brand-new-password',
    })
    expect(response.status).toBe(401)
  })

  it('rejects reusing the same password', async () => {
    const admin = trackAdmin(await createTestAdmin())
    await adminLogin({ email: admin.email, password: admin.password })

    const response = await changePassword({
      currentPassword: admin.password,
      newPassword: admin.password,
    })
    expect(response.status).toBe(400)
  })

  it('requires a session to change a password', async () => {
    expect(
      (await changePassword({ currentPassword: 'x', newPassword: 'a-good-password' })).status,
    ).toBe(401)
  })

  it('cannot be used to change another administrator’s password', async () => {
    const victim = trackAdmin(await createTestAdmin({ password: 'victim-password' }))
    const attacker = trackAdmin(await createTestAdmin({ password: 'attacker-password' }))
    await adminLogin({ email: attacker.email, password: attacker.password })

    // The target is the session's own account — there is no id field to point
    // elsewhere, and a strict schema rejects one if supplied.
    const response = await changePassword({
      currentPassword: 'attacker-password',
      newPassword: 'new-attacker-password',
      adminId: victim.id,
    })
    expect(response.status).toBe(400)

    // The victim's credentials still work.
    resetTestCookieJar()
    await primeCsrf()
    expect((await adminLogin({ email: victim.email, password: 'victim-password' })).status).toBe(
      200,
    )
  })
})

describe('audit log immutability is not weakened by M1', () => {
  it('the application role still cannot update an audit entry', async () => {
    const admin = trackAdmin(await createTestAdmin())
    await adminLogin({ email: admin.email, password: admin.password })

    await expect(
      db
        .update(auditLogs)
        .set({ entityType: 'tampered' })
        .where(and(eq(auditLogs.adminId, admin.id))),
    ).rejects.toThrow(/permission denied/i)
  })
})
