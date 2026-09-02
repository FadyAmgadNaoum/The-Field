import { boolean, char, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

/**
 * Venues (Doc 05 §4.1).
 *
 * Exactly one row in V1. The table exists so that courts, bookings, hours and
 * CMS content are venue-scoped from day one and a future multi-venue migration
 * does not require rewriting the booking engine (Doc 17 §3.1).
 *
 * No customer or admin UI ever exposes venue selection (Doc 24 §B.4).
 */
export const venues = pgTable('venues', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  address: text('address'),
  city: varchar('city', { length: 100 }),
  country: varchar('country', { length: 100 }).default('Egypt'),
  timezone: varchar('timezone', { length: 50 }).notNull().default('Africa/Cairo'),
  currency: char('currency', { length: 3 }).notNull().default('EGP'),

  /**
   * Booking reference prefix — RC-003 (Doc 21 §3).
   * Read from this column at booking creation. NEVER a code constant
   * (Doc 24 §M item 12).
   */
  bookingRefPrefix: varchar('booking_ref_prefix', { length: 10 }).notNull().default('TF'),

  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export type Venue = typeof venues.$inferSelect
export type NewVenue = typeof venues.$inferInsert
