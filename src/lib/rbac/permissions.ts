/**
 * Permission catalogue and role assignments (Doc 24 §E.5).
 *
 * This module is DATA, not logic. `requirePermission` and the session model
 * arrive in Milestone 1; the seed script needs this list at Milestone 0.
 *
 * Two corrections from Doc 24 §E.5 are baked in:
 *
 *  1. `view_customers` is new. Doc 10 §4.2 and Doc 22 §7.3 gave the read-only
 *     `viewer` role `manage_customers`, which gates the mutating
 *     PATCH /admin/customers/{id}. Doc 05 §4.12 even defines the permission as
 *     "View and search customers" — one string was doing two jobs. Reads and
 *     writes are now separate.
 *
 *  2. `viewer` therefore holds only the four read permissions, preserving the
 *     documented intent ("can view bookings, customers, audit logs") while
 *     closing the write path.
 */

export const PERMISSIONS = [
  'view_bookings',
  'approve_booking',
  'reject_booking',
  'cancel_booking',
  'verify_payment',
  'reject_payment',
  'view_payment_proof',
  'manage_courts',
  'manage_pricing',
  'manage_schedule',
  'view_customers',
  'manage_customers',
  'manage_cms',
  'manage_admins',
  'view_audit_logs',
  'manage_settings',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const ROLE_NAMES = ['super_admin', 'admin', 'viewer'] as const
export type RoleName = (typeof ROLE_NAMES)[number]

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  super_admin: 'Full access. Can manage administrators, view all data, change all settings.',
  admin: 'Day-to-day booking operations. Cannot manage administrator accounts.',
  viewer: 'Read-only access to bookings, payment proofs, customers and audit logs.',
}

/** Read-only permissions granted to `viewer` (Doc 24 §E.5). */
const VIEWER_PERMISSIONS: readonly Permission[] = [
  'view_bookings',
  'view_payment_proof',
  'view_customers',
  'view_audit_logs',
]

export const ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  admin: PERMISSIONS.filter((permission) => permission !== 'manage_admins'),
  viewer: VIEWER_PERMISSIONS,
}
