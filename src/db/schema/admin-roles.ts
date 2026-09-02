import { pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

/**
 * Administrator roles (Doc 05 §4.12).
 *
 * Exactly three in V1: super_admin, admin, viewer (Doc 24 §E.5). Roles are
 * seeded, not created through the API (Doc 11 §5.10).
 */
export const adminRoles = pgTable('admin_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type AdminRole = typeof adminRoles.$inferSelect
export type NewAdminRole = typeof adminRoles.$inferInsert
