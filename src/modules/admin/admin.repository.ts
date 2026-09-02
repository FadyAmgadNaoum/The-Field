import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { adminRolePermissions, adminRoles, adminUsers } from '@/db/schema'

/**
 * Administrator data access (Doc 22 M1-T03).
 *
 * Repositories run queries and hold no business logic (Doc 04 §7). Nothing here
 * ever returns a password hash to a caller outside the service layer.
 */

export interface AdminRecord {
  id: string
  email: string
  passwordHash: string
  fullName: string
  roleId: string
  roleName: string
  isActive: boolean
  mustChangePassword: boolean
  sessionsInvalidatedAt: Date | null
}

/** Safe projection — never contains the password hash (Doc 02 FR-SEC-013). */
export interface AdminProfile {
  id: string
  email: string
  fullName: string
  roleId: string
  roleName: string
  mustChangePassword: boolean
}

export function toAdminProfile(admin: AdminRecord): AdminProfile {
  return {
    id: admin.id,
    email: admin.email,
    fullName: admin.fullName,
    roleId: admin.roleId,
    roleName: admin.roleName,
    mustChangePassword: admin.mustChangePassword,
  }
}

const baseSelection = {
  id: adminUsers.id,
  email: adminUsers.email,
  passwordHash: adminUsers.passwordHash,
  fullName: adminUsers.fullName,
  roleId: adminUsers.roleId,
  roleName: adminRoles.name,
  isActive: adminUsers.isActive,
  mustChangePassword: adminUsers.mustChangePassword,
  sessionsInvalidatedAt: adminUsers.sessionsInvalidatedAt,
}

/** Login lookup. Soft-deleted accounts are invisible. */
export async function findByEmail(email: string): Promise<AdminRecord | null> {
  const rows = await db
    .select(baseSelection)
    .from(adminUsers)
    .innerJoin(adminRoles, eq(adminRoles.id, adminUsers.roleId))
    .where(and(eq(adminUsers.email, email.toLowerCase()), isNull(adminUsers.deletedAt)))
    .limit(1)

  return rows[0] ?? null
}

/**
 * Session validation lookup. Returns only live, active accounts, so deactivating
 * an administrator takes effect on their very next request (Doc 10 §2.3).
 */
export async function findActiveById(id: string): Promise<AdminRecord | null> {
  const rows = await db
    .select(baseSelection)
    .from(adminUsers)
    .innerJoin(adminRoles, eq(adminRoles.id, adminUsers.roleId))
    .where(and(eq(adminUsers.id, id), eq(adminUsers.isActive, true), isNull(adminUsers.deletedAt)))
    .limit(1)

  return rows[0] ?? null
}

export async function recordSuccessfulLogin(id: string, ip: string | null): Promise<void> {
  await db
    .update(adminUsers)
    .set({ lastLoginAt: new Date(), ...(ip ? { lastLoginIp: ip } : {}), updatedAt: new Date() })
    .where(eq(adminUsers.id, id))
}

/**
 * Change a password and clear the forced-change flag.
 *
 * `sessions_invalidated_at` is advanced so every session issued before the
 * change stops working — a password change must evict anyone holding a session
 * obtained with the old credentials (Doc 10 §2.3).
 */
export async function updatePassword(id: string, passwordHash: string): Promise<void> {
  await db
    .update(adminUsers)
    .set({
      passwordHash,
      mustChangePassword: false,
      sessionsInvalidatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(adminUsers.id, id))
}

/** Permission strings for a role. */
export async function getPermissionsForRole(roleId: string): Promise<string[]> {
  const rows = await db
    .select({ permission: adminRolePermissions.permission })
    .from(adminRolePermissions)
    .where(eq(adminRolePermissions.roleId, roleId))

  return rows.map((row) => row.permission)
}
