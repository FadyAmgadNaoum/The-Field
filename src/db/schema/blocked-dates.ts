import { date, index, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { adminUsers } from './admin-users'
import { venues } from './venues'

/**
 * Fully blocked calendar dates, e.g. public holidays (Doc 05 §4.5).
 * A blocked date makes every slot at the venue unavailable (Doc 02 FR-BKG-023).
 */
export const blockedDates = pgTable(
  'blocked_dates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    blockedDate: date('blocked_date', { mode: 'string' }).notNull(),
    reason: varchar('reason', { length: 255 }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => adminUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uqBlockedDate: unique('uq_blocked_date').on(table.venueId, table.blockedDate),
    idxBlockedDatesVenue: index('idx_blocked_dates_venue').on(table.venueId, table.blockedDate),
  }),
)

export type BlockedDate = typeof blockedDates.$inferSelect
export type NewBlockedDate = typeof blockedDates.$inferInsert
