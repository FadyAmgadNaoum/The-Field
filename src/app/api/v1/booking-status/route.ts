import { z } from 'zod'
import { assertJsonContentType, withApiHandler } from '@/lib/api/handler'
import { parseJsonBody } from '@/lib/api/parse'
import { apiSuccess } from '@/lib/api/response'
import { requireCustomerSession } from '@/lib/auth/customer-session'
import { venueConfig } from '@/lib/config'
import { NotFoundError } from '@/lib/errors'
import {
  accountKey,
  bookingStatusAccountLimiter,
  bookingStatusIpLimiter,
  consume,
  ipKey,
} from '@/lib/rate-limit'
import * as bookingsService from '@/modules/bookings/bookings.service'

/**
 * Customer booking status lookup (Doc 22 M2-T10, Doc 11 §4.4, Doc 10 §3.5).
 *
 * ── WHY A POST ───────────────────────────────────────────────────────────────
 * The reference identifies a booking and would otherwise appear in access logs,
 * browser history and `Referer` headers on every outbound link. Doc 11 §1 rule
 * 6 keeps identifying values out of URLs; a POST body keeps it out of all four.
 *
 * ── AUTHORISATION ────────────────────────────────────────────────────────────
 * The session establishes WHO. The reference only selects WHICH of that
 * account's bookings. There is no anonymous reference + phone fallback and one
 * must never be added (Doc 24 §E.1).
 *
 * A reference that exists but belongs to another account is answered exactly
 * like one that does not exist — same status, same message, same shape — so the
 * endpoint cannot be used to discover whether a reference is real
 * (Doc 13 T-004).
 *
 * ── ORDER OF WORK ────────────────────────────────────────────────────────────
 * Content type → session → rate limit → validate → service. The session is
 * resolved before the limiter because the account is the primary rate-limit key
 * (Doc 24 §I.6); an unauthenticated caller is rejected with a 401 having
 * consumed nothing, and is separately bounded by the NGINX general zone.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bookingStatusSchema = z.object({
  reference: z
    .string()
    .trim()
    .min(1, 'Enter your booking reference.')
    .max(20, 'That is not a valid booking reference.'),
})

export const POST = withApiHandler(async (request, { requestId }) => {
  assertJsonContentType(request)

  const customer = await requireCustomerSession()

  await consume(bookingStatusAccountLimiter, accountKey('booking-status', customer.customerId))
  await consume(bookingStatusIpLimiter, ipKey(request, 'booking-status'))

  const { reference } = await parseJsonBody(request, bookingStatusSchema)

  // A malformed reference cannot match anything, so it is answered as
  // "not found" rather than as a validation error. Distinguishing the two would
  // tell a prober which shapes are worth trying.
  if (!bookingsService.isWellFormedReference(reference)) {
    throw new NotFoundError('No booking with that reference was found.')
  }

  const booking = await bookingsService.getStatusForCustomer(
    reference,
    customer.customerId,
    venueConfig.id,
  )

  return apiSuccess({ booking }, { requestId })
})
