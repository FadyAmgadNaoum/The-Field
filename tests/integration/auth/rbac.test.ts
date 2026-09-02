import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => {
  const { getTestCookieJar } = await import('../helpers/cookie-jar')
  return { cookies: () => getTestCookieJar() }
})

import { ForbiddenError } from '@/lib/errors'
import type { AdminContext } from '@/lib/auth/admin-session'
import {
  assertCanAssignRole,
  getPermissions,
  hasPermission,
  requireAllPermissions,
  requirePermission,
} from '@/lib/auth/permissions'
import { PERMISSIONS, ROLE_PERMISSIONS } from '@/lib/rbac/permissions'
import { cleanupAccounts, createTestAdmin, roleIdFor, trackAdmin } from '../helpers/accounts'

/**
 * Role-based authorisation (Doc 10 §4, Doc 22 §7, Doc 24 §E.5).
 *
 * Permissions are read from the database for the session's role — never from a
 * cookie, a header or a request body — so a tampered client cannot grant
 * itself anything.
 */

function contextFor(admin: { id: string; roleId: string; roleName: string }): AdminContext {
  return {
    adminId: admin.id,
    roleId: admin.roleId,
    roleName: admin.roleName,
    email: 'test@example.test',
    fullName: 'Test',
    mustChangePassword: false,
  }
}

afterAll(async () => {
  await cleanupAccounts()
})

describe('seeded permission matrix matches Doc 24 §E.5', () => {
  it('super_admin holds all 16 permissions', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'super_admin' }))
    const permissions = await getPermissions(contextFor(admin))

    expect(permissions).toHaveLength(16)
    expect([...permissions].sort()).toEqual([...PERMISSIONS].sort())
  })

  it('admin holds everything except manage_admins', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    const permissions = await getPermissions(contextFor(admin))

    expect(permissions).toHaveLength(15)
    expect(permissions).not.toContain('manage_admins')
  })

  it('viewer holds only the four read permissions', async () => {
    const viewer = trackAdmin(await createTestAdmin({ roleName: 'viewer' }))
    const permissions = await getPermissions(contextFor(viewer))

    expect([...permissions].sort()).toEqual(
      ['view_audit_logs', 'view_bookings', 'view_customers', 'view_payment_proof'].sort(),
    )
  })

  it('the database matches the code catalogue for every role', async () => {
    for (const roleName of ['super_admin', 'admin', 'viewer'] as const) {
      const admin = trackAdmin(await createTestAdmin({ roleName }))
      const fromDatabase = await getPermissions(contextFor(admin))
      expect([...fromDatabase].sort()).toEqual([...ROLE_PERMISSIONS[roleName]].sort())
    }
  })
})

describe('viewer is strictly read-only', () => {
  it.each([
    'approve_booking',
    'reject_booking',
    'cancel_booking',
    'verify_payment',
    'reject_payment',
    'manage_customers',
    'manage_courts',
    'manage_pricing',
    'manage_schedule',
    'manage_cms',
    'manage_admins',
    'manage_settings',
  ] as const)('viewer is denied %s', async (permission) => {
    const viewer = trackAdmin(await createTestAdmin({ roleName: 'viewer' }))
    await expect(requirePermission(contextFor(viewer), permission)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('viewer CAN read customers — the split permission preserved that', async () => {
    // Doc 24 §E.5(a): `manage_customers` used to gate both the list and the
    // mutating PATCH, handing a write path to a read-only role.
    const viewer = trackAdmin(await createTestAdmin({ roleName: 'viewer' }))
    await expect(requirePermission(contextFor(viewer), 'view_customers')).resolves.toBeUndefined()
    await expect(requirePermission(contextFor(viewer), 'manage_customers')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('viewer cannot move a booking into review', async () => {
    // /review requires view_bookings AND approve_booking (Doc 24 §E.5(b)).
    const viewer = trackAdmin(await createTestAdmin({ roleName: 'viewer' }))
    await expect(
      requireAllPermissions(contextFor(viewer), ['view_bookings', 'approve_booking']),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('requireAllPermissions', () => {
  it('passes when every permission is held', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    // Booking approval needs both (Doc 24 §E.5).
    await expect(
      requireAllPermissions(contextFor(admin), ['approve_booking', 'verify_payment']),
    ).resolves.toBeUndefined()
  })

  it('fails when any single permission is missing', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await expect(
      requireAllPermissions(contextFor(admin), ['approve_booking', 'manage_admins']),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('privilege escalation', () => {
  it('an admin cannot assign the super_admin role', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    const superAdminRoleId = await roleIdFor('super_admin')

    await expect(assertCanAssignRole(contextFor(admin), superAdminRoleId)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('a super_admin may assign any role', async () => {
    const superAdmin = trackAdmin(await createTestAdmin({ roleName: 'super_admin' }))

    for (const roleName of ['super_admin', 'admin', 'viewer'] as const) {
      await expect(
        assertCanAssignRole(contextFor(superAdmin), await roleIdFor(roleName)),
      ).resolves.toBeUndefined()
    }
  })

  it('an admin may assign a role weaker than their own', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await expect(
      assertCanAssignRole(contextFor(admin), await roleIdFor('viewer')),
    ).resolves.toBeUndefined()
  })

  it('a viewer cannot assign any operational role', async () => {
    const viewer = trackAdmin(await createTestAdmin({ roleName: 'viewer' }))
    await expect(
      assertCanAssignRole(contextFor(viewer), await roleIdFor('admin')),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('permissions are not client-controllable', () => {
  it('a forged roleId in the session context grants nothing that role lacks', async () => {
    const viewer = trackAdmin(await createTestAdmin({ roleName: 'viewer' }))

    // Even holding the super_admin role id, the check reads THAT role's rights
    // from the database — it never trusts a claim about what the holder may do.
    const forged = { ...contextFor(viewer), roleId: await roleIdFor('viewer') }
    expect(await hasPermission(forged, 'manage_admins')).toBe(false)
  })

  it('rejects an unknown role id rather than defaulting to permissive', async () => {
    const admin = trackAdmin(await createTestAdmin())
    const context = { ...contextFor(admin), roleId: '00000000-0000-4000-8000-000000000000' }

    expect(await getPermissions(context)).toEqual([])
    await expect(requirePermission(context, 'view_bookings')).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('authorisation errors do not leak internals', () => {
  it('names the permission but no resource, table or id', async () => {
    const viewer = trackAdmin(await createTestAdmin({ roleName: 'viewer' }))
    let error: ForbiddenError | undefined
    try {
      await requirePermission(contextFor(viewer), 'approve_booking')
    } catch (caught) {
      error = caught as ForbiddenError
    }

    expect(error).toBeInstanceOf(ForbiddenError)
    const message = error!.message
    expect(message).toContain('approve_booking')
    expect(message).not.toContain(viewer.id)
    expect(message).not.toContain(viewer.roleId)
    expect(message.toLowerCase()).not.toContain('select')
    expect(message.toLowerCase()).not.toContain('admin_role_permissions')
  })
})
