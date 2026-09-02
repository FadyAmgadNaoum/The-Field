import { boolean, integer, pgTable, time, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { venues } from './venues'

/**
 * Venue operating hours (Doc 05 §4.4).
 *
 * OBD-004 IS UNRESOLVED. This table starts EMPTY — the seed script must not
 * invent a schedule (Doc 22 §4.5, Doc 24 §D.4). The administrator configures it
 * through the dashboard in Milestone 5.
 *
 * `close_time` may be '24:00:00' for a venue that closes at midnight; the final
 * bookable slot is then 23:00–24:00 (Doc 22 M3-T04, Doc 24 §F.4).
 */
export const operatingHours = pgTable(
  'operating_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    /** 0 = Sunday … 6 = Saturday. */
    dayOfWeek: integer('day_of_week').notNull(),
    openTime: time('open_time').notNull(),
    closeTime: time('close_time').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uqOperatingHours: unique('uq_operating_hours').on(table.venueId, table.dayOfWeek),
  }),
)

export type OperatingHours = typeof operatingHours.$inferSelect
export type NewOperatingHours = typeof operatingHours.$inferInsert
