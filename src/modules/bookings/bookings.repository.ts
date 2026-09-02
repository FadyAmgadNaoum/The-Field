import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { bookings, type BookingStatus } from '@/db/schema'

/**
 * Booking data access (Doc 22 §6.3), read side only.
 *
 * ── SCOPE AT MILESTONE 2 ─────────────────────────────────────────────────────
 * Only the status lookup behind `POST /api/v1/booking-status` (Doc 22 M2-T10).
 * Booking creation, the SERIALIZABLE conflict transaction, the reference
 * generator, the state machine and the expiry job are Milestone 3 (Doc 24 §N)
 * and are deliberately absent — there is no function here that writes.
 *
 * ── OWNERSHIP ────────────────────────────────────────────────────────────────
 * `findByReferenceAndCustomerAccount` is the name Doc 24 §E.1 mandates, and the
 * shape matters: the customer account id is part of the WHERE clause, not a
 * check applied to a row that was already fetched. A reference belonging to
 * another account produces no row at all, so there is nothing for a bug in a
 * later branch to leak.
 *
 * Phone-based lookup does not exist and must never be added (Doc 24 §E.1).
 */

export interface BookingStatusRow {
  courtId: string
  bookingReference: string
  bookingDate: string
  startTime: string
  endTime: string
  priceAmount: string
  currency: string
  status: BookingStatus
  rejectionReason: string | null
  cancellationReason: string | null
  /** Internal id — used only to fetch the payment summary. Never returned. */
  id: string
}

export async function findByReferenceAndCustomerAccount(
  bookingReference: string,
  customerAccountId: string,
  venueId: string,
): Promise<BookingStatusRow | null> {
  const rows = await db
    .select({
      id: bookings.id,
      courtId: bookings.courtId,
      bookingReference: bookings.bookingReference,
      bookingDate: bookings.bookingDate,
      startTime: bookings.startTime,
      endTime: bookings.endTime,
      priceAmount: bookings.priceAmount,
      currency: bookings.currency,
      status: bookings.status,
      rejectionReason: bookings.rejectionReason,
      cancellationReason: bookings.cancellationReason,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.bookingReference, bookingReference),
        // Ownership. Always from the session (Doc 24 §E.1, §M item 4).
        eq(bookings.customerAccountId, customerAccountId),
        // Venue scope. From VENUE_ID, never a request field (Doc 24 §M item 16).
        eq(bookings.venueId, venueId),
      ),
    )
    .limit(1)

  return rows[0] ?? null
}
