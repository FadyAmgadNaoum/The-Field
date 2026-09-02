import { ForbiddenError } from '../errors'
import * as adminRepo from '@/modules/admin/admin.repository'
import type { Permission } from '../rbac/permissions'
import type { AdminContext } from './admin-session'

/**
 * Server-side authorisation (Doc 10 §4.3, Doc 22 §7.2, Doc 24 §E.5).
 *
 * Authentication and authorisation are separate steps: `requireAdminSession`
 * establishes WHO, this module decides WHAT. Every mutation checks here, on the
 * server. The UI hides controls an administrator cannot use, but that hiding is
 * cosmetic — it is never the control (Doc 22 §7.2).
 *
 * Permissions are read from the database per role, never from the session
 * cookie or any request field, so a tampered cookie cannot grant a permission.
 */

export async function getPermissions(session: AdminContext): Promise<Permission[]> {
  const permissions = await adminRepo.getPermissionsForRole(session.roleId)
  return permissions as Permission[]
}

export async function hasPermission(
  session: AdminContext,
  permission: Permission,
): Promise<boolean> {
  const permissions = await getPermissions(session)
  return permissions.includes(permission)
}

/**
 * Assert a single permission. Throws ForbiddenError (403).
 *
 * The message names the permission but no resource, so a 403 cannot be used to
 * probe whether a particular record exists (Doc 13 T-004).
 */
export async function requirePermission(
  session: AdminContext,
  permission: Permission,
): Promise<void> {
  const permissions = await getPermissions(session)
  if (!permissions.includes(permission)) {
    throw new ForbiddenError(`Permission '${permission}' is required for this action.`)
  }
}

/**
 * Assert several permissions at once — ALL must be held.
 *
 * Booking approval requires `approve_booking` AND `verify_payment`; marking a
 * booking under review requires `view_bookings` AND `approve_booking`
 * (Doc 24 §E.5). One round trip instead of one per permission.
 */
export async function requireAllPermissions(
  session: AdminContext,
  required: readonly Permission[],
): Promise<void> {
  const permissions = await getPermissions(session)
  const missing = required.filter((permission) => !permissions.includes(permission))

  if (missing.length > 0) {
    throw new ForbiddenError(`Permission '${missing[0]}' is required for this action.`)
  }
}

/**
 * Privilege-escalation guard for administrator management (Doc 22 §7.5).
 *
 * An administrator may only assign a role whose permission set is a subset of
 * their own. Without this, an `admin` holding `manage_admins` could mint a
 * `super_admin` and escalate.
 *
 * Used by the administrator management routes in Milestone 5; defined here so
 * the rule lives with the rest of the authorisation logic.
 */
export async function assertCanAssignRole(
  session: AdminContext,
  targetRoleId: string,
): Promise<void> {
  const [own, target] = await Promise.all([
    adminRepo.getPermissionsForRole(session.roleId),
    adminRepo.getPermissionsForRole(targetRoleId),
  ])

  const ownSet = new Set(own)
  if (!target.every((permission) => ownSet.has(permission))) {
    throw new ForbiddenError('Cannot assign a role with permissions beyond your own.')
  }
}
