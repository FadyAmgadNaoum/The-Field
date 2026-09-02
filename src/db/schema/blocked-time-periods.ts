import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { adminUsers } from './admin-users'
import { courts } from './courts'
import { venues } from './venues'

/**
 * Blocked time windows (Doc 05 §4.6).
 * `court_id` NULL means the block applies to every court at the venue
 * (Doc 08 §7.3).
 */
export const blockedTimePeriods = pgTable(
  'blocked_time_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    courtId: uuid('court_id').references(() => courts.id, { onDelete: 'restrict' }),
    startDatetime: timestamp('start_datetime', { withTimezone: true }).notNull(),
    endDatetime: timestamp('end_datetime', { withTimezone: true }).notNull(),
    reason: varchar('reason', { length: 255 }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => adminUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idxBlockedPeriodsVenue: index('idx_blocked_periods_venue').on(
      table.venueId,
      table.startDatetime,
      table.endDatetime,
    ),
  }),
)

export type BlockedTimePeriod = typeof blockedTimePeriods.$inferSelect
export type NewBlockedTimePeriod = typeof blockedTimePeriods.$inferInsert
