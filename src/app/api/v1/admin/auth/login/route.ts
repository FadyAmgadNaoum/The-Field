import { assertJsonContentType, withApiHandler } from '@/lib/api/handler'
import { parseJsonBody } from '@/lib/api/parse'
import { apiSuccess } from '@/lib/api/response'
import { establishAdminSession } from '@/lib/auth/admin-session'
import { assertCsrfToken } from '@/lib/auth/csrf'
import { adminLoginLimiter, consume, ipKey, reset } from '@/lib/rate-limit'
import { adminLoginSchema } from '@/lib/validation/auth'
import * as adminService from '@/modules/admin/admin.service'

/**
 * Administrator sign-in (Doc 08 §2, Doc 22 §6.2, M1-T04).
 *
 * Brute-force protection is layered: NGINX limits this path to 5r/m per IP
 * (nginx/thefield.conf), and the application enforces 5 attempts per IP per
 * 15 minutes with a 15 minute block (Doc 19 AC-ADM-001).
 *
 * The limiter is consumed BEFORE credentials are checked, so a blocked IP
 * cannot keep guessing — and the lockout holds even when the correct password
 * is finally supplied, which is what AC-ADM-001 requires.
 *
 * Every outcome is audited: `admin_login` on success, `admin_login_failed`
 * with a reason on every rejection (Doc 08 §2).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withApiHandler(async (request, { requestId, clientIp }) => {
  const rateKey = ipKey(request, 'admin-login')
  await consume(adminLoginLimiter, rateKey)

  assertJsonContentType(request)
  assertCsrfToken(request)

  const input = await parseJsonBody(request, adminLoginSchema)
  const admin = await adminService.login(input.email, input.password, {
    ip: clientIp,
    requestId,
  })

  await reset(adminLoginLimiter, rateKey)
  await establishAdminSession({ id: admin.id, roleId: admin.roleId })

  // No password hash, no session internals — only what the dashboard needs.
  return apiSuccess(
    {
      email: admin.email,
      fullName: admin.fullName,
      role: admin.roleName,
      mustChangePassword: admin.mustChangePassword,
    },
    { requestId },
  )
})
