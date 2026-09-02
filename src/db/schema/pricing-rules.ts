import {
  boolean,
  char,
  index,
  integer,
  numeric,
  pgTable,
  time,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { courts } from './courts'

/**
 * Court pricing rules (Doc 05 §4.3).
 *
 * Resolution: rules matching the booking's day-of-week (in Africa/Cairo) and
 * time window are collected, the highest `priority` wins, and the resulting
 * amount is written immutably onto the booking (Doc 05 §4.3, Doc 24 §M item 9).
 *
 * Price is never accepted from a client (Doc 13 T-007). Calculation lands in
 * Milestone 3.
 */
export const courtPricingRules = pgTable(
  'court_pricing_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courtId: uuid('court_id')
      .notNull()
      .references(() => courts.id, { onDelete: 'restrict' }),
    label: varchar('label', { length: 100 }).notNull(),
    priceAmount: numeric('price_amount', { precision: 10, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('EGP'),
    /** 0 = Sunday … 6 = Saturday. e.g. {4,5,6} for Thu/Fri/Sat. */
    applicableDays: integer('applicable_days').array().notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    /** Higher wins when several rules match the same slot. */
    priority: integer('priority').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    idxPricingCourt: index('idx_pricing_court').on(table.courtId, table.isActive),
  }),
)

export type CourtPricingRule = typeof courtPricingRules.$inferSelect
export type NewCourtPricingRule = typeof courtPricingRules.$inferInsert
