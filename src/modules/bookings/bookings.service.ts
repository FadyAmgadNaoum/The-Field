import { NotFoundError } from '@/lib/errors'
import type { BookingStatus } from '@/db/schema'
import * as courtsService from '@/modules/courts/courts.service'
import * as paymentsService from '@/modules/payments/payments.service'
import * as repo from './bookings.repository'

/**
 * Booking service — status lookup only (Doc 22 M2-T10, Doc 10 §3.5).
 *
 * ── WHAT THE CUSTOMER IS ALLOWED TO SEE ──────────────────────────────────────
 * Doc 10 §3.5 and Doc 11 §4.4: friendly status labels, the court, the date and
 * time, the price and the payment state. Explicitly NOT: the booking's UUID,
 * the customer account id, internal admin notes, the IP address, the user
 * agent, the identity of the administrator who acted, or a payment proof URL.
 *
 * `CustomerBookingStatus` below is that allow-list expressed as a type. A field
 * added to the `bookings` table in a later milestone cannot leak through this
 * function by accident — it has to be added here deliberately.
 *
 * Cancellation and rejection reasons ARE included: Doc 24 §G.1 requires the
 * customer to see why a payment was rejected so they can re-upload.
 *
 * Nothing in this path is cached. Booking state is transactional truth and is
 * always read live (Doc 24 §M item 2).
 */

export interface CustomerBookingStatus {
  reference: string
  status: BookingStatus
  courtName: string | null
  /** 'YYYY-MM-DD', the venue-local business date (Doc 24 §D.2). */
  date: string
  /** 'HH:MM', venue-local wall-clock. */
  startTime: string
  endTime: string
  price: { amount: string; currency: string }
  payment: {
    status: paymentsService.PaymentSummary['status'] | null
    rejectionReason: string | null
  }
  /** Present only when the venue rejected or cancelled the booking. */
  reason: string | null
  /**
   * Whether the venue's workflow currently expects a payment proof.
   *
   * Derived on the SERVER from the stored status. The browser is told the
   * answer; it never computes it, and the upload endpoint re-checks eligibility
   * independently when it lands in Milestone 4 (Doc 24 §M item 3).
   */
  awaitingPaymentProof: boolean
}

/** PostgreSQL returns TIME as 'HH:MM:SS'. Customers see 'HH:MM'. */
function toDisplayTime(value: string): string {
  return value.slice(0, 5)
}

/**
 * Booking reference format (Doc 05 §5, Doc 21 RC-003).
 *
 * `{prefix}-YYYYMMDD-XXXX`. The prefix comes from `venues.booking_ref_prefix`
 * and is deliberately NOT hardcoded here — matching a generic prefix keeps this
 * check a cheap input filter rather than a second source of truth for the
 * format (Doc 24 §M item 12).
 */
const REFERENCE_PATTERN = /^[A-Z0-9]{1,10}-\d{8}-[A-Z0-9]{4}$/

export function isWellFormedReference(value: string): boolean {
  return REFERENCE_PATTERN.test(value.toUpperCase())
}

/**
 * Look up one booking owned by the authenticated customer.
 *
 * Throws NotFoundError both when the reference does not exist and when it
 * belongs to someone else. The two cases are indistinguishable to the caller,
 * which is what stops the endpoint being used to enumerate references
 * (Doc 13 T-004, Doc 10 §3.5).
 */
export async function getStatusForCustomer(
  bookingReference: string,
  customerAccountId: string,
  venueId: string,
): Promise<CustomerBookingStatus> {
  const normalised = bookingReference.trim().toUpperCase()

  const booking = await repo.findByReferenceAndCustomerAccount(
    normalised,
    customerAccountId,
    venueId,
  )
  if (!booking) throw new NotFoundError('No booking with that reference was found.')

  const [courtNames, payment] = await Promise.all([
    courtsService.getCourtNames(venueId, [booking.courtId]),
    paymentsService.getPaymentSummary(booking.id),
  ])

  return {
    reference: booking.bookingReference,
    status: booking.status,
    courtName: courtNames.get(booking.courtId) ?? null,
    date: booking.bookingDate,
    startTime: toDisplayTime(booking.startTime),
    endTime: toDisplayTime(booking.endTime),
    price: { amount: booking.priceAmount, currency: booking.currency },
    payment: {
      status: payment?.status ?? null,
      rejectionReason: payment?.rejectionReason ?? null,
    },
    reason: booking.rejectionReason ?? booking.cancellationReason ?? null,
    awaitingPaymentProof: isAwaitingPaymentProof(booking.status),
  }
}

/**
 * A booking is awaiting proof only while it is `pending`.
 *
 * Doc 06 §5 and Doc 24 §G.1: `pending → payment_submitted` is the customer
 * transition, and a payment rejection returns the booking to `pending` with a
 * fresh expiry so the customer can re-upload. Every other state — including the
 * three terminal ones — is not awaiting anything from the customer.
 */
export function isAwaitingPaymentProof(status: BookingStatus): boolean {
  return status === 'pending'
}
