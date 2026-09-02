import bcrypt from 'bcryptjs'

/**
 * Password hashing (Doc 03 NFR-SEC-006, Doc 10 §2.5, Doc 22 §6.4).
 *
 * bcrypt at cost factor 12 — roughly 300–400ms per comparison, which makes
 * offline brute force impractical while staying acceptable for an interactive
 * login (Doc 13 T-005).
 *
 * Used for both administrator and customer credentials. Plaintext passwords are
 * never stored, logged, or returned.
 */

export const BCRYPT_COST = 12

/** bcrypt silently truncates input beyond 72 bytes. Reject rather than truncate. */
export const MAX_PASSWORD_BYTES = 72
export const MIN_PASSWORD_LENGTH = 8

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasswordPolicyError'
  }
}

/**
 * Validate a candidate password against the documented policy.
 *
 * Doc 10 §2.5: minimum 8 characters, no maximum length limit — but bcrypt's
 * 72-byte input ceiling must be an explicit rejection, never a silent
 * truncation that would make two different passwords equivalent.
 */
export function assertPasswordPolicy(plaintext: string): void {
  if (plaintext.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }
  if (Buffer.byteLength(plaintext, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new PasswordPolicyError(`Password must not exceed ${MAX_PASSWORD_BYTES} bytes.`)
  }
}

export async function hashPassword(plaintext: string): Promise<string> {
  assertPasswordPolicy(plaintext)
  return bcrypt.hash(plaintext, BCRYPT_COST)
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false rather than throwing for any malformed or absent hash, so a
 * Google-only account (password_hash IS NULL) cannot be logged into with a
 * password.
 */
export async function verifyPassword(
  plaintext: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) return false
  if (Buffer.byteLength(plaintext, 'utf8') > MAX_PASSWORD_BYTES) return false
  try {
    return await bcrypt.compare(plaintext, hash)
  } catch {
    return false
  }
}

/**
 * Constant-time padding for unknown accounts (Doc 22 §6.2).
 *
 * Without this, "no such user" returns in microseconds while a real user costs
 * ~350ms of bcrypt — a timing oracle that enumerates valid email addresses.
 * Callers must await this on the not-found path before returning the generic
 * error.
 */
const DUMMY_HASH = bcrypt.hashSync('dummy-password-never-matches-anything', BCRYPT_COST)

export async function dummyCompare(plaintext: string): Promise<void> {
  try {
    await bcrypt.compare(plaintext.slice(0, MAX_PASSWORD_BYTES), DUMMY_HASH)
  } catch {
    // Never let the timing guard itself change control flow.
  }
}
