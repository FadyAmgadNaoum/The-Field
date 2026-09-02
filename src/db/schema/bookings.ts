import {
  char,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { adminUsers } from './admin-users'
import { courts } from './courts'
import { customerAccounts } from './customer-accounts'
import { inet } from './column-types'
import { venues } from './venues'

export const bookingStatusEnum = pgEnum('booking_status', [
  'pending',
  'payment_submitted',
  'under_review',
  'approved',
  'rejected',
  'cancelled',
  'expired',
])

/**
 * Bookings (Doc 05 §4.9).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO OBJECTS ARE NOT DEFINED HERE — they live in
 * src/db/migrations/raw/0001_booking_integrity.sql:
 *
 *   1. the `booking_range` STORED generated column
 *   2. the `no_overlapping_approved_bookings` GiST exclusion constraint
 *
 * Drizzle's schema DSL cannot express either (Doc 22 §4.3). They are the
 * database-level double-booking guarantee and must never be weakened, dropped
 * or made conditional (Doc 23 §4.2, Doc 24 §M item 1).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * NO `chk_booking_date_future` CHECK CONSTRAINT — RC-005 (Doc 21 §3).
 * PostgreSQL's CURRENT_DATE is UTC while the venue runs at UTC+2, so the
 * constraint would reject a valid same-evening booking made after 22:00 local
 * time. Date validation happens in the service layer, where the comparison can
 * be timezone-aware.
 *
 * `price_amount` is immutable after creation (Doc 03 NFR-DATA-003).
 * Rows are never hard-deleted (Doc 03 NFR-DATA-007); `app_user` lacks DELETE.
 */
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Format {prefix}-YYYYMMDD-XXXX. Prefix from venues.booking_ref_prefix. */
    bookingReference: varchar('booking_reference', { length: 20 }).notNull().unique(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    courtId: uuid('court_id')
      .notNull()
      .references(() => courts.id, { onDelete: 'restrict' }),
    /** Ownership. Always from the authenticated session (Doc 24 §E.1). */
    customerAccountId: uuid('customer_account_id')
      .notNull()
      .references(() => customerAccounts.id, { onDelete: 'restrict' }),

    /** Venue-local wall-clock values (Africa/Cairo). See Doc 24 §D.2. */
    bookingDate: date('booking_date', { mode: 'string' }).notNull(),
    startTime: time('start_time').notNull(),
    /** May be '24:00:00' for the final slot of a midnight close (Doc 24 §F.4). */
    endTime: time('end_time').notNull(),

    /** Immutable financial record (Doc 05 §1.2). */
    priceAmount: numeric('price_amount', { precision: 10, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('EGP'),

    status: bookingStatusEnum('status').notNull().default('pending'),

    approvedBy: uuid('approved_by').references(() => adminUsers.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedBy: uuid('rejected_by').references(() => adminUsers.id),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    cancelledBy: uuid('cancelled_by').references(() => adminUsers.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),

    /**
     * Set at creation to NOW() + BOOKING_EXPIRY_MINUTES. Left untouched when
     * proof is uploaded, cleared on approval, and reset to a fresh window when
     * an administrator rejects a payment and returns the booking to `pending`
     * (Doc 24 §F.5, §G.1).
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    notes: text('notes'),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idxBookingsCourtDate: index('idx_bookings_court_date').on(table.courtId, table.bookingDate),
    idxBookingsStatus: index('idx_bookings_status').on(table.status),
    idxBookingsCustomerAccount: index('idx_bookings_customer_account').on(table.customerAccountId),
    idxBookingsReference: index('idx_bookings_reference').on(table.bookingReference),
  }),
)

export type Booking = typeof bookings.$inferSelect
export type NewBooking = typeof bookings.$inferInsert
export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number]
