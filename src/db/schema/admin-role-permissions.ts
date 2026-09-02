import { index, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { adminRoles } from './admin-roles'

/**
 * Role → permission mapping (Doc 05 §4.12).
 *
 * Permission strings are checked server-side at the service layer on every
 * mutation. The final 16-permission set is defined in src/lib/rbac/permissions.ts
 * (Doc 24 §E.5) and seeded from there.
 */
export const adminRolePermissions = pgTable(
  'admin_role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => adminRoles.id, { onDelete: 'cascade' }),
    permission: varchar('permission', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uqRolePermission: unique('uq_role_permission').on(table.roleId, table.permission),
    idxRolePermissions: index('idx_role_permissions').on(table.roleId),
  }),
)

export type AdminRolePermission = typeof adminRolePermissions.$inferSelect
export type NewAdminRolePermission = typeof adminRolePermissions.$inferInsert
