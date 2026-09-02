import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { adminUsers } from './admin-users'
import { courts } from './courts'

/**
 * Court maintenance windows (Doc 05 §4.7).
 *
 * Creating a maintenance period does NOT cancel confirmed bookings inside it.
 * The administrator is warned and must cancel them explicitly (Doc 08 §7.4).
 */
export const maintenancePeriods = pgTable(
  'maintenance_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courtId: uuid('court_id')
      .notNull()
      .references(() => courts.id, { onDelete: 'restrict' }),
    startDatetime: timestamp('start_datetime', { withTimezone: true }).notNull(),
    endDatetime: timestamp('end_datetime', { withTimezone: true }).notNull(),
    reason: varchar('reason', { length: 255 }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => adminUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idxMaintenanceCourt: index('idx_maintenance_court').on(
      table.courtId,
      table.startDatetime,
      table.endDatetime,
    ),
  }),
)

export type MaintenancePeriod = typeof maintenancePeriods.$inferSelect
export type NewMaintenancePeriod = typeof maintenancePeriods.$inferInsert
