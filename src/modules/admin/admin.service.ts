import { UnauthorizedError, ValidationError } from '@/lib/errors'
import {
  assertPasswordPolicy,
  dummyCompare,
  hashPassword,
  PasswordPolicyError,
  verifyPassword,
} from '@/lib/auth/password'
import * as audit from '@/modules/audit/audit.service'
import * as adminRepo from './admin.repository'
import { toAdminProfile, type AdminProfile } from './admin.repository'

/**
 * Administrator authentication (Doc 08 §2, Doc 22 §6.2).
 *
 * Framework-agnostic: no Request, no Response, no cookies. The route handler
 * owns HTTP and session cookies; this owns the rules (Doc 03 NFR-MAINT-009).
 */

/**
 * One message for every failure mode.
 *
 * "No such account" and "wrong password" must be indistinguishable, or the
 * login form becomes an account-enumeration oracle (Doc 08 §2, Doc 13 T-005).
 */
const GENERIC_LOGIN_FAILURE = 'Invalid email or password.'

export interface LoginContext {
  ip: string | null
  requestId?: string
}

export async function login(
  email: string,
  password: string,
  context: LoginContext,
): Promise<AdminProfile> {
  const admin = await adminRepo.findByEmail(email)

  if (!admin) {
    // Spend the same ~350ms bcrypt would have cost, so response time does not
    // reveal whether the address exists (Doc 22 §6.2).
    await dummyCompare(password)
    await audit.log({
      action: 'admin_login_failed',
      entityType: 'admin_user',
      metadata: { reason: 'unknown_email', ip: context.ip, requestId: context.requestId },
    })
    throw new UnauthorizedError(GENERIC_LOGIN_FAILURE)
  }

  if (!admin.isActive) {
    await dummyCompare(password)
    await audit.log({
      action: 'admin_login_failed',
      adminId: admin.id,
      entityType: 'admin_user',
      entityId: admin.id,
      metadata: { reason: 'inactive', ip: context.ip, requestId: context.requestId },
    })
    throw new UnauthorizedError(GENERIC_LOGIN_FAILURE)
  }

  if (!(await verifyPassword(password, admin.passwordHash))) {
    await audit.log({
      action: 'admin_login_failed',
      adminId: admin.id,
      entityType: 'admin_user',
      entityId: admin.id,
      metadata: { reason: 'bad_password', ip: context.ip, requestId: context.requestId },
    })
    throw new UnauthorizedError(GENERIC_LOGIN_FAILURE)
  }

  await adminRepo.recordSuccessfulLogin(admin.id, context.ip)
  await audit.log({
    action: 'admin_login',
    adminId: admin.id,
    entityType: 'admin_user',
    entityId: admin.id,
    metadata: { ip: context.ip, requestId: context.requestId },
  })

  return toAdminProfile(admin)
}

export async function recordLogout(adminId: string, context: LoginContext): Promise<void> {
  await audit.log({
    action: 'admin_logout',
    adminId,
    entityType: 'admin_user',
    entityId: adminId,
    metadata: { ip: context.ip, requestId: context.requestId },
  })
}

/**
 * Change an administrator's own password (Doc 22 M1-T12).
 *
 * The current password is re-verified even though the caller already holds a
 * session, so a hijacked session cannot lock the real owner out.
 *
 * `updatePassword` advances `sessions_invalidated_at`, which invalidates every
 * session issued before the change — including any the attacker holds.
 */
export async function changePassword(
  adminId: string,
  currentPassword: string,
  newPassword: string,
  context: LoginContext,
): Promise<void> {
  const admin = await adminRepo.findActiveById(adminId)
  if (!admin) throw new UnauthorizedError('Administrator authentication is required.')

  if (!(await verifyPassword(currentPassword, admin.passwordHash))) {
    await audit.log({
      action: 'admin_login_failed',
      adminId,
      entityType: 'admin_user',
      entityId: adminId,
      metadata: { reason: 'change_password_bad_current', ip: context.ip },
    })
    throw new UnauthorizedError('Current password is incorrect.')
  }

  if (currentPassword === newPassword) {
    throw new ValidationError('The new password must be different from the current password.')
  }

  try {
    assertPasswordPolicy(newPassword)
  } catch (error) {
    if (error instanceof PasswordPolicyError) throw new ValidationError(error.message)
    throw error
  }

  await adminRepo.updatePassword(adminId, await hashPassword(newPassword))

  await audit.log({
    action: 'admin_updated',
    adminId,
    entityType: 'admin_user',
    entityId: adminId,
    // The passwords themselves are never recorded — only that a change happened.
    metadata: { change: 'password', ip: context.ip, requestId: context.requestId },
  })
}
