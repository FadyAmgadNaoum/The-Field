import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { paymentRecords, type PaymentStatus } from '@/db/schema'

/**
 * Payment record data access (Doc 05 §4.10), read side only.
 *
 * Milestone 2 needs one thing from this table: the payment status and any
 * rejection reason shown on the customer's booking-status page (Doc 22 M2-T10).
 * Creating payment records, the proof upload pipeline and the verification
 * workflow are Milestone 4 (Doc 24 §N).
 */

export interface PaymentSummaryRow {
  bookingId: string
  status: PaymentStatus
  rejectionReason: string | null
}

export async function listSummariesForBookings(
  bookingIds: readonly string[],
): Promise<PaymentSummaryRow[]> {
  if (bookingIds.length === 0) return []

  return db
    .select({
      bookingId: paymentRecords.bookingId,
      status: paymentRecords.status,
      rejectionReason: paymentRecords.rejectionReason,
    })
    .from(paymentRecords)
    .where(inArray(paymentRecords.bookingId, [...bookingIds]))
}

export async function findSummaryForBooking(bookingId: string): Promise<PaymentSummaryRow | null> {
  const rows = await db
    .select({
      bookingId: paymentRecords.bookingId,
      status: paymentRecords.status,
      rejectionReason: paymentRecords.rejectionReason,
    })
    .from(paymentRecords)
    .where(eq(paymentRecords.bookingId, bookingId))
    .limit(1)

  return rows[0] ?? null
}
