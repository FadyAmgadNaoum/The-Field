import { withApiHandler } from '@/lib/api/handler'
import { apiSuccess } from '@/lib/api/response'
import { requireCustomerSession } from '@/lib/auth/customer-session'

/**
 * The signed-in customer's own profile (Doc 10 §3.5).
 *
 * Returns 401 when unauthenticated. The response is derived entirely from the
 * session — there is no id parameter to tamper with, so this endpoint has no
 * IDOR surface by construction.
 *
 * Deliberately excluded: password hash, internal admin notes, and the account's
 * primary key.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withApiHandler(async (_request, { requestId }) => {
  const customer = await requireCustomerSession()

  return apiSuccess({ email: customer.email, fullName: customer.fullName }, { requestId })
})
