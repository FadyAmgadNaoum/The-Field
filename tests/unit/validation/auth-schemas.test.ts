import { describe, expect, it } from 'vitest'
import {
  adminChangePasswordSchema,
  adminLoginSchema,
  customerLoginSchema,
  customerRegisterSchema,
} from '@/lib/validation/auth'

/**
 * Request schemas (Doc 11 §6, Doc 21 SF-006).
 *
 * The `.strict()` behaviour is the mass-assignment control: a field that is not
 * in the schema is not merely ignored, it is rejected — so an attempt to smuggle
 * `roleId`, `isActive` or `customerId` fails loudly instead of silently.
 */

describe('customerRegisterSchema', () => {
  const valid = {
    email: 'Customer@Example.COM',
    password: 'a-good-password',
    fullName: '  Ahmed Mohamed  ',
  }

  it('accepts a valid registration and normalises input', () => {
    const parsed = customerRegisterSchema.parse(valid)
    expect(parsed.email).toBe('customer@example.com')
    expect(parsed.fullName).toBe('Ahmed Mohamed')
  })

  it.each([
    ['roleId', { roleId: 'super-admin-role' }],
    ['isActive', { isActive: true }],
    ['id', { id: '00000000-0000-4000-8000-000000000000' }],
    ['passwordHash', { passwordHash: '$2a$12$forged' }],
    ['googleId', { googleId: 'attacker-google-id' }],
  ])('rejects an attempt to mass-assign %s', (_label, extra) => {
    expect(customerRegisterSchema.safeParse({ ...valid, ...extra }).success).toBe(false)
  })

  it('rejects a password below the minimum length', () => {
    expect(customerRegisterSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false)
  })

  it('rejects a password beyond bcrypt’s byte ceiling', () => {
    expect(customerRegisterSchema.safeParse({ ...valid, password: 'a'.repeat(73) }).success).toBe(
      false,
    )
  })

  it('rejects a malformed email address', () => {
    expect(customerRegisterSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(
      false,
    )
  })

  it('rejects an empty name', () => {
    expect(customerRegisterSchema.safeParse({ ...valid, fullName: ' ' }).success).toBe(false)
  })
})

describe('login schemas', () => {
  it.each([
    ['customer', customerLoginSchema],
    ['admin', adminLoginSchema],
  ])('%s login accepts credentials and lowercases the email', (_label, schema) => {
    const parsed = schema.parse({ email: 'Admin@Example.COM', password: 'x' })
    expect(parsed.email).toBe('admin@example.com')
  })

  it('does not apply the strength policy at login', () => {
    // Rejecting weak passwords here would tell an attacker which candidates are
    // worth trying, and would lock out holders of pre-policy credentials.
    expect(customerLoginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true)
  })

  it('rejects an empty password', () => {
    expect(customerLoginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false)
  })

  it('rejects extra fields on admin login', () => {
    expect(
      adminLoginSchema.safeParse({
        email: 'a@b.co',
        password: 'x',
        mustChangePassword: false,
      }).success,
    ).toBe(false)
  })
})

describe('adminChangePasswordSchema', () => {
  it('accepts a valid change', () => {
    expect(
      adminChangePasswordSchema.safeParse({
        currentPassword: 'old-password',
        newPassword: 'new-password',
      }).success,
    ).toBe(true)
  })

  it('applies the strength policy to the new password only', () => {
    expect(
      adminChangePasswordSchema.safeParse({
        currentPassword: 'x',
        newPassword: 'short',
      }).success,
    ).toBe(false)
  })

  it('rejects an attempt to target another administrator', () => {
    expect(
      adminChangePasswordSchema.safeParse({
        currentPassword: 'old-password',
        newPassword: 'new-password',
        adminId: '00000000-0000-4000-8000-000000000000',
      }).success,
    ).toBe(false)
  })
})
