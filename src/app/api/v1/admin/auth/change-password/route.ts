import { assertJsonContentType, withApiHandler } from '@/lib/api/handler'
import { parseJsonBody } from '@/lib/api/parse'
import { apiSuccess } from '@/lib/api/response'
import { destroyAdminSession, requireAdminSession } from '@/lib/auth/admin-session'
import { assertCsrfToken } from '@/lib/auth/csrf'
import { adminChangePasswordSchema } from '@/lib/validation/auth'
import * as adminService from '@/modules/admin/admin.service'

/**
 * Administrator password change (Doc 22 M1-T12, Doc 21 RC-007b).
 *
 * Reachable while `must_change_password` is set — it is the ONLY route that is,
 * which is what forces a seeded temporary credential to be replaced before the
 * dashboard can be used.
 *
 * Changing the password advances `sessions_invalidated_at`, so every session
 * issued beforehand — including the one making this request — becomes invalid.
 * The current session is therefore destroyed here and the administrator signs
 * in again with the new password. That is deliberate: if the old credential was
 * compromised, any session an attacker holds dies with it.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withApiHandler(async (request, { requestId, clientIp }) => {
  assertJsonContentType(request)
  assertCsrfToken(request)

  const session = await requireAdminSession()
  const input = await parseJsonBody(request, adminChangePasswordSchema)

  await adminService.changePassword(session.adminId, input.currentPassword, input.newPassword, {
    ip: clientIp,
    requestId,
  })

  await destroyAdminSession()

  return apiSuccess({ passwordChanged: true, reauthenticationRequired: true }, { requestId })
})
