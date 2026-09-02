import { describe, expect, it } from 'vitest'
import {
  BCRYPT_COST,
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  PasswordPolicyError,
  assertPasswordPolicy,
  dummyCompare,
  hashPassword,
  verifyPassword,
} from '@/lib/auth/password'

/** Password handling (Doc 03 NFR-SEC-006, Doc 10 §2.5, Doc 22 §6.4). */

describe('hashPassword', () => {
  it('produces a bcrypt hash at cost 12', async () => {
    const hash = await hashPassword('correct horse battery')
    // $2a$12$ — algorithm and cost are encoded in the prefix.
    expect(hash).toMatch(/^\$2[aby]\$12\$/)
    expect(BCRYPT_COST).toBe(12)
  })

  it('never returns the plaintext', async () => {
    const plaintext = 'correct horse battery'
    expect(await hashPassword(plaintext)).not.toContain(plaintext)
  })

  it('salts — the same password hashes differently each time', async () => {
    const [first, second] = await Promise.all([
      hashPassword('same-password-here'),
      hashPassword('same-password-here'),
    ])
    expect(first).not.toBe(second)
  })
})

describe('verifyPassword', () => {
  it('accepts the correct password', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(await verifyPassword('correct horse battery', hash)).toBe(true)
  })

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(await verifyPassword('wrong horse battery', hash)).toBe(false)
  })

  it('rejects when the account has no password hash', async () => {
    // A Google-only account must not be reachable with a password.
    expect(await verifyPassword('anything at all', null)).toBe(false)
    expect(await verifyPassword('anything at all', undefined)).toBe(false)
  })

  it('returns false rather than throwing on a malformed hash', async () => {
    expect(await verifyPassword('anything at all', 'not-a-bcrypt-hash')).toBe(false)
  })

  it('does not accept a 72-byte truncation of a longer password', async () => {
    // bcrypt silently truncates at 72 bytes. If a longer password were allowed
    // to be hashed, every string sharing its first 72 bytes would unlock the
    // account. The policy rejects those at set time; verify rejects them too.
    const long = 'a'.repeat(80)
    expect(await verifyPassword(long, await hashPassword('a'.repeat(MAX_PASSWORD_BYTES)))).toBe(
      false,
    )
  })
})

describe('assertPasswordPolicy', () => {
  it(`requires at least ${MIN_PASSWORD_LENGTH} characters`, () => {
    expect(() => assertPasswordPolicy('short')).toThrow(PasswordPolicyError)
    expect(() => assertPasswordPolicy('a'.repeat(MIN_PASSWORD_LENGTH))).not.toThrow()
  })

  it('rejects input beyond bcrypt’s 72-byte ceiling instead of truncating', () => {
    expect(() => assertPasswordPolicy('a'.repeat(MAX_PASSWORD_BYTES + 1))).toThrow(/72 bytes/)
  })

  it('counts bytes, not characters, for multi-byte passwords', () => {
    // 30 four-byte emoji = 120 bytes, well past the ceiling despite the short
    // visible length.
    expect(() => assertPasswordPolicy('😀'.repeat(30))).toThrow(/72 bytes/)
  })

  it('allows a long password that fits within the byte ceiling', () => {
    expect(() => assertPasswordPolicy('a'.repeat(MAX_PASSWORD_BYTES))).not.toThrow()
  })
})

describe('dummyCompare', () => {
  it('resolves without throwing, whatever it is given', async () => {
    await expect(dummyCompare('anything')).resolves.toBeUndefined()
    await expect(dummyCompare('')).resolves.toBeUndefined()
    await expect(dummyCompare('a'.repeat(500))).resolves.toBeUndefined()
  })

  it('costs real time, so an unknown account is not faster than a known one', async () => {
    // The timing guard only works if it actually performs the bcrypt work.
    const startedAt = Date.now()
    await dummyCompare('some-password')
    expect(Date.now() - startedAt).toBeGreaterThan(20)
  })
})
