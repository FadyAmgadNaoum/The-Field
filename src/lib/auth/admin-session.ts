import { UnauthorizedError } from '../errors'
import * as adminRepo from '@/modules/admin/admin.repository'
import { getAdminApiSessionCookie, getAdminSessionCookie, type AdminSessionData } from './sessions'

/**
 * Administrator session resolution (Doc 10 §2.3, Doc 22 §6.2).
 *
 * Every protected request re-reads the administrator row. That costs one query,
 * and buys immediate revocation: deactivating an account, or changing its
 * password, takes effect on the very next request instead of waiting up to
 * eight hours for the cookie to expire (Doc 19 AC-ADM-004).
 *
 * ── COOKIE SCOPING ───────────────────────────────────────────────────────────
 * Doc 10 §2.4 and Doc 24 §16.4 require `Path=/admin` on the admin cookie, while
 * Doc 11 §5 places the admin API under `/api/v1/admin` and states it requires
 * that same cookie. Those two facts are incompatible as written: a browser
 * never sends a `/admin`-scoped cookie to `/api/v1/admin`.
 *
 * Resolution: the session is written to BOTH scopes on login and cleared from
 * both on logout. Each remains narrowly scoped — neither is widened to `/` —
 * so the documented isolation property is preserved and the admin API is
 * actually reachable. Reported as a specification gap in the M1 report.
 */

export interface AdminContext {
  adminId: string
  roleId: string
  roleName: string
  email: string
  fullName: string
  /** True while a temporary password is still in force (Doc 21 RC-007b). */
  mustChangePassword: boolean
}

/**
 * Resolve the current administrator, or null.
 *
 * Returns null — never throws — for every rejection path, so callers cannot
 * accidentally distinguish "no cookie" from "revoked account".
 */
export async function getAdminSession(): Promise<AdminContext | null> {
  const session = await getAdminSessionCookie()
  return resolveAdminSession(session)
}

async function resolveAdminSession(session: AdminSessionData): Promise<AdminContext | null> {
  if (!session.adminId || !session.issuedAt) return null

  const admin = await adminRepo.findActiveById(session.adminId)
  // Covers: deleted, deactivated, or an id that no longer exists.
  if (!admin) return null

  // Session revocation (Doc 10 §2.3). Any session minted before the
  // invalidation instant is treated as expired.
  if (admin.sessionsInvalidatedAt && session.issuedAt < admin.sessionsInvalidatedAt.getTime()) {
    return null
  }

  // A role change must not leave elevated permissions cached in a cookie.
  if (session.roleId && session.roleId !== admin.roleId) return null

  return {
    adminId: admin.id,
    roleId: admin.roleId,
    roleName: admin.roleName,
    email: admin.email,
    fullName: admin.fullName,
    mustChangePassword: admin.mustChangePassword,
  }
}

/** Throws UnauthorizedError (401) when there is no valid administrator session. */
export async function requireAdminSession(): Promise<AdminContext> {
  const context = await getAdminSession()
  if (!context) throw new UnauthorizedError('Administrator authentication is required.')
  return context
}

/**
 * Guard for every administrator route except the change-password flow itself.
 *
 * Doc 22 §6.2: while `must_change_password` is set, the only reachable admin
 * route is the password change. A temporary credential must not be able to
 * operate the dashboard.
 */
export async function requireUsableAdminSession(): Promise<AdminContext> {
  const context = await requireAdminSession()
  if (context.mustChangePassword) {
    throw new UnauthorizedError('Password change required before continuing.')
  }
  return context
}

/** Write the session to both cookie scopes. */
export async function establishAdminSession(admin: {
  id: string
  roleId: string
}): Promise<number> {
  const issuedAt = Date.now()

  for (const getCookie of [getAdminSessionCookie, getAdminApiSessionCookie]) {
    const session = await getCookie()
    session.adminId = admin.id
    session.roleId = admin.roleId
    session.issuedAt = issuedAt
    await session.save()
  }

  return issuedAt
}

/** Clear both cookie scopes. Idempotent. */
export async function destroyAdminSession(): Promise<void> {
  for (const getCookie of [getAdminSessionCookie, getAdminApiSessionCookie]) {
    const session = await getCookie()
    session.destroy()
  }
}
