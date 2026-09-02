import { describe, expect, it } from 'vitest'
import { isAwaitingPaymentProof, isWellFormedReference } from '@/modules/bookings/bookings.service'
import { bookingStatusEnum } from '@/db/schema'

/**
 * Booking status helpers (Doc 22 M2-T10, Doc 06 §5, Doc 24 §G.1).
 *
 * `isAwaitingPaymentProof` is a SERVER decision that the browser is told, never
 * one the browser makes. Getting it wrong in the permissive direction would
 * offer an upload control for a terminal booking; in the restrictive direction
 * it would strand a customer who needs to re-upload after a payment rejection.
 */

describe('isWellFormedReference', () => {
  it('accepts the documented format', () => {
    expect(isWellFormedReference('TF-20260910-A2K9')).toBe(true)
  })

  it('is case-insensitive, matching the lookup which upper-cases first', () => {
    expect(isWellFormedReference('tf-20260910-a2k9')).toBe(true)
  })

  it('accepts a prefix other than TF', () => {
    // The prefix comes from venues.booking_ref_prefix and is never a constant
    // in code (Doc 21 RC-003, Doc 24 §M item 12). A venue configured with a
    // different prefix must still be able to look its bookings up.
    expect(isWellFormedReference('PADEL-20260910-A2K9')).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['no prefix', '-20260910-A2K9'],
    ['short date', 'TF-2026091-A2K9'],
    ['short suffix', 'TF-20260910-A2K'],
    ['long suffix', 'TF-20260910-A2K99'],
    ['wrong separator', 'TF_20260910_A2K9'],
    ['sql fragment', "TF-20260910-A2K9' OR '1'='1"],
    ['wildcard', 'TF-20260910-%'],
    ['whitespace injection', 'TF-20260910-A2K9 OR 1=1'],
  ])('rejects a reference that is %s', (_label, value) => {
    expect(isWellFormedReference(value)).toBe(false)
  })
})

describe('isAwaitingPaymentProof', () => {
  it('is true only for pending', () => {
    // Doc 06 §5: `pending -> payment_submitted` is the customer's transition,
    // and Doc 24 §G.1 returns a booking to `pending` after a payment rejection
    // precisely so the customer can re-upload.
    expect(isAwaitingPaymentProof('pending')).toBe(true)
  })

  it.each(['payment_submitted', 'under_review', 'approved', 'rejected', 'cancelled', 'expired'])(
    'is false for %s',
    (status) => {
      expect(isAwaitingPaymentProof(status as 'pending')).toBe(false)
    },
  )

  it('is false for every terminal state', () => {
    // Doc 24 §M item 7: rejected, cancelled and expired are terminal. Offering
    // an upload for one of them would invite a customer to send money for a
    // slot they cannot have.
    for (const status of ['rejected', 'cancelled', 'expired'] as const) {
      expect(isAwaitingPaymentProof(status)).toBe(false)
    }
  })

  it('has an answer for every status the enum can hold', () => {
    // If a status is added to the database enum later, this proves the helper
    // still returns a boolean for it rather than undefined.
    for (const status of bookingStatusEnum.enumValues) {
      expect(typeof isAwaitingPaymentProof(status)).toBe('boolean')
    }
  })
})
