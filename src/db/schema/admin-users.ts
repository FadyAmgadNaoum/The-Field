import { boolean, pgTable, timestamp, uuid, varchar, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { adminRoles } from './admin-roles'
import { inet } from './column-types'

/**
 * Administrator accounts (Doc 05 §4.13).
 *
 * Passwords are bcrypt cost 12 (Doc 03 NFR-SEC-006). Authentication itself is
 * implemented in Milestone 1 — this is the schema only.
 */
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  roleId: uuid('role_id')
    .notNull()
    .references(() => adminRoles.id, { onDelete: 'restrict' }),
  isActive: boolean('is_active').notNull().default(true),

  /** RC-007b (Doc 21 §3). Forces a password change on first login. */
  mustChangePassword: boolean('must_change_password').notNull().default(false),

  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  lastLoginIp: inet('last_login_ip'),
  createdBy: uuid('created_by').references((): AnyPgColumn => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),

  /**
   * Session revocation (Doc 10 §2.3). Any session issued before this timestamp
   * is treated as expired on its next request, so deactivating an administrator
   * takes effect immediately rather than at cookie expiry.
   */
  sessionsInvalidatedAt: timestamp('sessions_invalidated_at', { withTimezone: true }),
})

export type AdminUser = typeof adminUsers.$inferSelect
export type NewAdminUser = typeof adminUsers.$inferInsert
