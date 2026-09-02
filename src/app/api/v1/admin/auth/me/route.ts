import { withApiHandler } from '@/lib/api/handler'
import { apiSuccess } from '@/lib/api/response'
import { requireAdminSession } from '@/lib/auth/admin-session'
import { getPermissions } from '@/lib/auth/permissions'
import { adminMutationLimiter, consume } from '@/lib/rate-limit'

/**
 * Current administrator profile and permissions (Doc 11 §5.1).
 *
 * The permission list is returned so the dashboard can hide controls the
 * administrator cannot use. That hiding is cosmetic only — every route
 * re-checks server-side regardless of what the client believes
 * (Doc 22 §7.2, Doc 24 §M item 15).
 *
 * Note this endpoint is reachable while `mustChangePassword` is set: the
 * change-password screen needs to know who it is talking to.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withApiHandler(async (_request, { requestId }) => {
  const session = await requireAdminSession()
  await consume(adminMutationLimiter, `admin:${session.adminId}`)

  const permissions = await getPermissions(session)

  return apiSuccess(
    {
      email: session.email,
      fullName: session.fullName,
      role: session.roleName,
      mustChangePassword: session.mustChangePassword,
      permissions,
    },
    { requestId },
  )
})
