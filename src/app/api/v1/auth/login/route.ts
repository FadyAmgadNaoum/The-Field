import { assertJsonContentType, withApiHandler } from '@/lib/api/handler'
import { parseJsonBody } from '@/lib/api/parse'
import { apiSuccess } from '@/lib/api/response'
import { assertCsrfToken } from '@/lib/auth/csrf'
import { establishCustomerSession } from '@/lib/auth/customer-session'
import {
  accountKey,
  consume,
  customerLoginAccountLimiter,
  customerLoginIpLimiter,
  ipKey,
  reset,
} from '@/lib/rate-limit'
import { customerLoginSchema } from '@/lib/validation/auth'
import * as customers from '@/modules/customers/customers.service'

/**
 * Customer sign-in (Doc 10 §3.1).
 *
 * Dual-keyed rate limiting (Doc 24 §I.6): per IP stops one host hammering many
 * accounts, per account stops many hosts hammering one account. Both must pass.
 *
 * The account key is consumed BEFORE the credential check so that failures
 * count, and reset only on success so an honest user is not penalised for a
 * typo (Doc 10 §2.6).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withApiHandler(async (request, { requestId }) => {
  const ipRateKey = ipKey(request, 'customer-login')
  await consume(customerLoginIpLimiter, ipRateKey)

  assertJsonContentType(request)
  assertCsrfToken(request)

  const input = await parseJsonBody(request, customerLoginSchema)

  const accountRateKey = accountKey('customer-login', input.email)
  await consume(customerLoginAccountLimiter, accountRateKey)

  const profile = await customers.login(input.email, input.password)

  await Promise.all([
    reset(customerLoginIpLimiter, ipRateKey),
    reset(customerLoginAccountLimiter, accountRateKey),
  ])

  await establishCustomerSession({ id: profile.id, email: profile.email })

  return apiSuccess({ email: profile.email, fullName: profile.fullName }, { requestId })
})
