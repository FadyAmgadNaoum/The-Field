import {
  char,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { adminUsers } from './admin-users'
import { bookings } from './bookings'
import { inet } from './column-types'

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'submitted',
  'verified',
  'rejected',
])

/**
 * Payment records (Doc 05 §4.10).
 *
 * Payment status is tracked independently of booking status (Doc 06 §3) and is
 * NEVER accepted from any client — only service functions set it
 * (Doc 13 T-009, Doc 24 §M item 6).
 *
 * `payment_method` is a column rather than an assumption so that a future
 * gateway can be added without touching the booking engine (Doc 17 §7).
 *
 * Rejecting a payment does NOT terminate the booking: it returns the booking to
 * `pending` with a fresh expiry so the customer can re-upload. Terminating the
 * booking is a separate action (Doc 24 §G.1).
 */
export const paymentRecords = pgTable(
  'payment_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .unique()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('EGP'),
    paymentMethod: varchar('payment_method', { length: 50 }).notNull().default('instapay'),
    status: paymentStatusEnum('status').notNull().default('pending'),

    proofSubmittedAt: timestamp('proof_submitted_at', { withTimezone: true }),
    submittedByIp: inet('submitted_by_ip'),

    verifiedBy: uuid('verified_by').references(() => adminUsers.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),

    rejectedBy: uuid('rejected_by').references(() => adminUsers.id),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idxPaymentsBooking: index('idx_payments_booking').on(table.bookingId),
    idxPaymentsStatus: index('idx_payments_status').on(table.status),
  }),
)

export type PaymentRecord = typeof paymentRecords.$inferSelect
export type NewPaymentRecord = typeof paymentRecords.$inferInsert
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number]
