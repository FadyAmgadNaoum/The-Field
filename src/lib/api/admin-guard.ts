import { assertJsonContentType } from './handler'
import { requireUsableAdminSession, type AdminContext } from '../auth/admin-session'
import { assertCsrfToken } from '../auth/csrf'
import { requirePermission } from '../auth/permissions'
import { adminMutationLimiter, consume } from '../rate-limit'
import type { Permission } from '../rbac/permissions'

/**
 * The standard administrator route preamble (Doc 21 SF-002, Doc 22 §5.2, §5.4).
 *
 * Doc 24 §M item 15 states the invariant every admin route must satisfy:
 * session → permission → venue scope → audit on mutation. Venue scope is
 * implicit in V1 (one venue, from `VENUE_ID`) and auditing belongs to the
 * service that performs the change, so this helper owns the first two plus the
 * transport-level defences that are easy to omit one route at a time.
 *
 * Order matters and is the documented one:
 *   content type → CSRF → session → rate limit → permission
 *
 * The rate limiter is keyed on the administrator and therefore consumed only
 * after the session resolves; an unauthenticated caller is rejected without
 * consuming anyone's budget, and is separately bounded by the NGINX zone.
 */

export interface AdminGuardOptions {
  /** Skip the JSON content-type requirement. Only for multipart uploads. */
  multipart?: boolean
}

export async function requireAdminFor(
  request: Request,
  permission: Permission,
  options: AdminGuardOptions = {},
): Promise<AdminContext> {
  // Doc 24 §E.4: `Content-Type: application/json` is the secondary CSRF control
  // for JSON mutations. A multipart upload cannot use it — a cross-origin HTML
  // form CAN send multipart — so those routes rely on SameSite plus the
  // explicit token, which is checked next either way.
  if (!options.multipart && request.method !== 'GET') {
    assertJsonContentType(request)
  }
  if (request.method !== 'GET') {
    assertCsrfToken(request)
  }

  const session = await requireUsableAdminSession()

  await consume(adminMutationLimiter, `admin:${session.adminId}`)
  await requirePermission(session, permission)

  return session
}
