import { UnauthorizedError, ValidationError } from '@/lib/errors'
import {
  assertPasswordPolicy,
  dummyCompare,
  hashPassword,
  PasswordPolicyError,
  verifyPassword,
} from '@/lib/auth/password'
import type { GoogleIdentity } from '@/lib/auth/google'
import * as customerRepo from './customers.repository'
import { toCustomerProfile, type CustomerProfile } from './customers.repository'

/**
 * Customer authentication (Doc 10 §3.1, Doc 23 REL-M1-T01).
 *
 * Two methods, one account model. A customer who registers with a password and
 * later signs in with Google on the same verified address lands on the same
 * account rather than a duplicate.
 *
 * Framework-agnostic — the route owns cookies and HTTP.
 */

const GENERIC_LOGIN_FAILURE = 'Invalid email or password.'

export interface RegisterInput {
  email: string
  password: string
  fullName: string
}

/**
 * Create an account with an email and password.
 *
 * A duplicate address is reported plainly. Registration inherently reveals
 * whether an address is taken — the form cannot succeed otherwise — so this is
 * disclosure the flow already requires, and it is rate limited (Doc 24 §I.6).
 */
export async function register(input: RegisterInput): Promise<CustomerProfile> {
  const email = input.email.trim().toLowerCase()
  const fullName = input.fullName.trim()

  try {
    assertPasswordPolicy(input.password)
  } catch (error) {
    if (error instanceof PasswordPolicyError) throw new ValidationError(error.message)
    throw error
  }

  const existing = await customerRepo.findByEmail(email)
  if (existing) {
    // Reported as a field-level validation failure rather than a new error
    // code: the catalogue in Doc 11 §3 is a fixed contract and must not grow
    // informally (Doc 24 §K S19j).
    throw new ValidationError('An account with this email address already exists.', {
      fieldErrors: { email: ['An account with this email address already exists.'] },
    })
  }

  const created = await customerRepo.create({
    email,
    fullName,
    passwordHash: await hashPassword(input.password),
  })

  return toCustomerProfile(created)
}

export async function login(email: string, password: string): Promise<CustomerProfile> {
  const customer = await customerRepo.findByEmail(email.trim().toLowerCase())

  if (!customer) {
    await dummyCompare(password)
    throw new UnauthorizedError(GENERIC_LOGIN_FAILURE)
  }

  // A Google-only account has no password hash. `verifyPassword` returns false
  // for a null hash, so it cannot be logged into with a password — and the
  // generic message does not disclose which method the account uses.
  if (!(await verifyPassword(password, customer.passwordHash))) {
    throw new UnauthorizedError(GENERIC_LOGIN_FAILURE)
  }

  return toCustomerProfile(customer)
}

/**
 * Resolve a verified Google identity to an account, creating one if needed.
 *
 * Order matters:
 *   1. match on `google_id` — the stable Google subject identifier
 *   2. otherwise match on email and link the Google id to that account
 *   3. otherwise create a new account
 *
 * Step 2 requires `email_verified`. Linking on an unverified address would let
 * anyone who can create a Google account claiming a victim's address take over
 * that account.
 */
export async function upsertFromGoogle(identity: GoogleIdentity): Promise<CustomerProfile> {
  const byGoogleId = await customerRepo.findByGoogleId(identity.googleId)
  if (byGoogleId) return toCustomerProfile(byGoogleId)

  const byEmail = await customerRepo.findByEmail(identity.email)
  if (byEmail) {
    if (!identity.emailVerified) {
      throw new UnauthorizedError(
        'This email address is already registered. Sign in with your password instead.',
      )
    }
    await customerRepo.linkGoogleId(byEmail.id, identity.googleId)
    return toCustomerProfile(byEmail)
  }

  const created = await customerRepo.create({
    email: identity.email,
    fullName: identity.fullName,
    googleId: identity.googleId,
    passwordHash: null,
  })

  return toCustomerProfile(created)
}
