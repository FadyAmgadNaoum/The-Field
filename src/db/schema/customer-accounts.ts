import { pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

/**
 * Customer accounts (Doc 05 §4.8).
 *
 * THE authoritative customer identity. Booking ownership is always derived from
 * the authenticated session's account id — never from a phone number and never
 * from a request field (Doc 10 §1/§3.5, Doc 19 AC-CUS-010, Doc 24 §E.1).
 *
 * Every phone-based lookup concept in Docs 04 §3/§4, 07 §4, 08 §8, 11 §4.5 and
 * 22 M3-T09 is obsolete — see the table in Doc 24 §E.1.
 *
 * `deleted_at` is added by Doc 24 §D.6: Doc 05 §7 promises soft deletion on
 * request and Doc 03 NFR-DATA-004 requires it, but the original table had no
 * column to express it.
 *
 * Authentication (Google via `arctic`, and email/password) is Milestone 1.
 */
export const customerAccounts = pgTable('customer_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  /** NULL for Google-only accounts. bcrypt cost 12 when present. */
  passwordHash: varchar('password_hash', { length: 255 }),
  /** NULL for email/password-only accounts. */
  googleId: varchar('google_id', { length: 255 }).unique(),
  /** Egyptian mobile, contact data only — never an identity (Doc 24 §E.1). */
  phoneNumber: varchar('phone_number', { length: 20 }),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  /** Internal administrator notes. Not visible to the customer. */
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export type CustomerAccount = typeof customerAccounts.$inferSelect
export type NewCustomerAccount = typeof customerAccounts.$inferInsert
