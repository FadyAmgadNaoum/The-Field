import { assertJsonContentType, withApiHandler } from '@/lib/api/handler'
import { parseJsonBody } from '@/lib/api/parse'
import { apiSuccess } from '@/lib/api/response'
import { assertCsrfToken } from '@/lib/auth/csrf'
import { establishCustomerSession } from '@/lib/auth/customer-session'
import { consume, customerRegisterLimiter, ipKey } from '@/lib/rate-limit'
import { customerRegisterSchema } from '@/lib/validation/auth'
import * as customers from '@/modules/customers/customers.service'

/**
 * Customer registration (Doc 10 §3.1, Doc 23 REL-M1-T01).
 *
 * Handler order is the documented one (Doc 22 §5.2):
 * rate limit -> content type -> CSRF -> validate -> service -> session -> respond.
 *
 * The response carries the customer's own profile only. No password, no
 * password hash, no internal ids beyond the account's own.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withApiHandler(async (request, { requestId }) => {
  await consume(customerRegisterLimiter, ipKey(request, 'customer-register'))

  assertJsonContentType(request)
  assertCsrfToken(request)

  const input = await parseJsonBody(request, customerRegisterSchema)
  const profile = await customers.register(input)

  // Sign the new customer in immediately — identity comes from this session
  // from here on, never from a request field (Doc 24 §E.1).
  await establishCustomerSession({ id: profile.id, email: profile.email })

  return apiSuccess(
    { email: profile.email, fullName: profile.fullName },
    { status: 201, requestId },
  )
})
