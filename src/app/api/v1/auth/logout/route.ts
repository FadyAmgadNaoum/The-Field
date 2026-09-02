import { assertJsonContentType, withApiHandler } from '@/lib/api/handler'
import { apiSuccess } from '@/lib/api/response'
import { assertCsrfToken } from '@/lib/auth/csrf'
import { destroyCustomerSession } from '@/lib/auth/customer-session'

/**
 * Customer sign-out (Doc 10 §3.1).
 *
 * Idempotent: signing out without a session still returns 200, so a stale tab
 * cannot produce a confusing error. Destroying the cookie is the whole
 * operation — there is no server-side session record to clean up
 * (Doc 23 SPOF-07).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withApiHandler(async (request, { requestId }) => {
  assertJsonContentType(request)
  assertCsrfToken(request)

  await destroyCustomerSession()

  return apiSuccess({ signedOut: true }, { requestId })
})
