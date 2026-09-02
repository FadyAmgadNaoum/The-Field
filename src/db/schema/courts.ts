import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { venues } from './venues'

/**
 * Courts (Doc 05 §4.2).
 *
 * NOTE: there is deliberately NO inline UNIQUE constraint on (venue_id, name).
 * PostgreSQL treats NULLs as distinct, so `UNIQUE (venue_id, name, deleted_at)`
 * would permit two active courts with the same name. RC-006 (Doc 21 §3)
 * replaces it with the partial unique index `uq_court_name_per_venue_active`,
 * created in src/db/migrations/raw/0002_indexes.sql.
 */
export const courts = pgTable(
  'courts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    courtType: varchar('court_type', { length: 50 }).notNull().default('padel'),
    /** e.g. ["covered", "lights", "premium_surface"] */
    features: jsonb('features'),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    idxCourtsVenueActive: index('idx_courts_venue_active').on(table.venueId, table.isActive),
  }),
)

export type Court = typeof courts.$inferSelect
export type NewCourt = typeof courts.$inferInsert
