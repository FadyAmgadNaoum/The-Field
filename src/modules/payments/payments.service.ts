import * as repo from './payments.repository'
import type { PaymentSummaryRow } from './payments.repository'

/**
 * Payment service — read side (Doc 22 M2-T10).
 *
 * The customer-visible slice of a payment record: its status, and the reason if
 * a proof was rejected. Nothing else from `payment_records` is exposed — the
 * verifying administrator, the timestamps and the submitting IP are internal
 * (Doc 10 §3.5, Doc 11 §4.4).
 */

export interface PaymentSummary {
  status: PaymentSummaryRow['status']
  /**
   * Shown to the customer so a rejected proof can be corrected and re-uploaded
   * (Doc 24 §G.1). Written by an administrator, so it is rendered as text and
   * never as markup.
   */
  rejectionReason: string | null
}

export async function getPaymentSummary(bookingId: string): Promise<PaymentSummary | null> {
  const row = await repo.findSummaryForBooking(bookingId)
  if (!row) return null
  return { status: row.status, rejectionReason: row.rejectionReason }
}
