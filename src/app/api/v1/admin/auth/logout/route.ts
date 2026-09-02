import { assertJsonContentType, withApiHandler } from '@/lib/api/handler'
import { apiSuccess } from '@/lib/api/response'
import { destroyAdminSession, getAdminSession } from '@/lib/auth/admin-session'
import { assertCsrfToken } from '@/lib/auth/csrf'

/**
 * Administrator sign-out (Doc 08 §2).
 *
 * Idempotent — returns 200 even without a session. Clears both admin cookie
 * scopes (`/admin` and `/api/v1/admin`).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withApiHandler(async (request, { requestId, clientIp }) => {
  assertJsonContentType(request)
  assertCsrfToken(request)

  // Read before destroying so the audit entry can name the administrator.
  const session = await getAdminSession()

  await destroyAdminSession()

  if (session) {
    const { recordLogout } = await import('@/modules/admin/admin.service')
    await recordLogout(session.adminId, { ip: clientIp, requestId })
  }

  return apiSuccess({ signedOut: true }, { requestId })
})
