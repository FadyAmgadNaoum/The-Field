import { describe, expect, it } from 'vitest'
import { PERMISSIONS, ROLE_NAMES, ROLE_PERMISSIONS } from '@/lib/rbac/permissions'

/** Final permission matrix (Doc 24 §E.5). */

describe('permission catalogue', () => {
  it('contains exactly 16 permissions', () => {
    expect(PERMISSIONS).toHaveLength(16)
    expect(new Set(PERMISSIONS).size).toBe(16)
  })

  it('separates reading customers from editing them', () => {
    // Doc 24 §E.5(a): `manage_customers` alone gated both the customer list and
    // the mutating PATCH, which handed a write path to the read-only role.
    expect(PERMISSIONS).toContain('view_customers')
    expect(PERMISSIONS).toContain('manage_customers')
  })
})

describe('roles', () => {
  it('defines exactly super_admin, admin and viewer', () => {
    expect([...ROLE_NAMES]).toEqual(['super_admin', 'admin', 'viewer'])
  })

  it('gives super_admin every permission', () => {
    expect(ROLE_PERMISSIONS.super_admin).toHaveLength(PERMISSIONS.length)
  })

  it('gives admin everything except manage_admins', () => {
    expect(ROLE_PERMISSIONS.admin).not.toContain('manage_admins')
    expect(ROLE_PERMISSIONS.admin).toHaveLength(PERMISSIONS.length - 1)
  })

  it('restricts viewer to the four read permissions', () => {
    expect([...ROLE_PERMISSIONS.viewer].sort()).toEqual(
      ['view_audit_logs', 'view_bookings', 'view_customers', 'view_payment_proof'].sort(),
    )
  })

  it('denies viewer every action that changes state', () => {
    const forbidden = [
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
    ] as const

    for (const permission of forbidden) {
      expect(ROLE_PERMISSIONS.viewer).not.toContain(permission)
    }
  })

  it('grants approve_booking only to roles that may approve — used to gate /review', () => {
    // Doc 24 §E.5(b): /review requires view_bookings AND approve_booking, so a
    // viewer cannot move a booking into under_review.
    expect(ROLE_PERMISSIONS.super_admin).toContain('approve_booking')
    expect(ROLE_PERMISSIONS.admin).toContain('approve_booking')
    expect(ROLE_PERMISSIONS.viewer).not.toContain('approve_booking')
  })
})
