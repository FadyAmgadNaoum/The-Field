import { describe, expect, it } from 'vitest'
import { createCsrfToken, isValidCsrfToken } from '@/lib/auth/csrf'

/** CSRF token integrity (Doc 10 §5.4, Doc 24 §E.4). */

describe('createCsrfToken', () => {
  it('produces a value and a signature', () => {
    const token = createCsrfToken()
    expect(token.split('.')).toHaveLength(2)
  })

  it('is unpredictable — no two tokens match', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createCsrfToken()))
    expect(tokens.size).toBe(200)
  })

  it('carries enough entropy to resist guessing', () => {
    const [value] = createCsrfToken().split('.')
    // 32 random bytes, base64url encoded.
    expect(value!.length).toBeGreaterThanOrEqual(40)
  })
})

describe('isValidCsrfToken', () => {
  it('accepts a token it minted', () => {
    expect(isValidCsrfToken(createCsrfToken())).toBe(true)
  })

  it('rejects a token with a tampered value but the original signature', () => {
    const token = createCsrfToken()
    const [, signature] = token.split('.')
    expect(isValidCsrfToken(`attacker-chosen-value.${signature}`)).toBe(false)
  })

  it('rejects a token with a tampered signature', () => {
    const [value] = createCsrfToken().split('.')
    expect(isValidCsrfToken(`${value}.forged-signature`)).toBe(false)
  })

  it('rejects a token invented from scratch', () => {
    // The HMAC is why a subdomain that can write cookies still cannot forge one.
    expect(isValidCsrfToken('some-value.some-signature')).toBe(false)
  })

  it.each([undefined, null, '', 'no-separator', '.only-signature'])(
    'rejects malformed input %p',
    (input) => {
      expect(isValidCsrfToken(input as string | null | undefined)).toBe(false)
    },
  )
})
