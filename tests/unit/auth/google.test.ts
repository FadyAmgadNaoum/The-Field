import { describe, expect, it } from 'vitest'
import { sanitiseRedirectTarget } from '@/lib/auth/google'

/**
 * Open-redirect protection on the OAuth flow (Doc 23 §16.4, Doc 24 §E.2).
 *
 * The post-sign-in destination is the one attacker-influenced value in the
 * flow. If it could name another origin, the OAuth callback would become an
 * open redirect usable for phishing.
 */

describe('sanitiseRedirectTarget', () => {
  it('accepts a same-origin relative path', () => {
    expect(sanitiseRedirectTarget('/book')).toBe('/book')
    expect(sanitiseRedirectTarget('/book?courtId=abc&date=2026-09-10')).toBe(
      '/book?courtId=abc&date=2026-09-10',
    )
  })

  it('falls back when nothing was supplied', () => {
    expect(sanitiseRedirectTarget(null)).toBe('/')
    expect(sanitiseRedirectTarget(undefined)).toBe('/')
    expect(sanitiseRedirectTarget('')).toBe('/')
  })

  it('rejects absolute URLs on another origin', () => {
    expect(sanitiseRedirectTarget('https://evil.example/steal')).toBe('/')
    expect(sanitiseRedirectTarget('http://evil.example')).toBe('/')
  })

  it('rejects protocol-relative URLs', () => {
    // `//evil.example` is a full origin change that still looks like a path.
    expect(sanitiseRedirectTarget('//evil.example/steal')).toBe('/')
  })

  it('rejects backslash variants that some parsers treat as a scheme', () => {
    expect(sanitiseRedirectTarget('/\\evil.example')).toBe('/')
    expect(sanitiseRedirectTarget('/path\\..\\evil')).toBe('/')
  })

  it('rejects embedded schemes', () => {
    expect(sanitiseRedirectTarget('/redirect?next=javascript://evil')).toBe('/')
  })

  it('rejects control characters and whitespace used to smuggle headers', () => {
    expect(sanitiseRedirectTarget('/book\nLocation: https://evil.example')).toBe('/')
    expect(sanitiseRedirectTarget('/book\r\nSet-Cookie: x=1')).toBe('/')
    expect(sanitiseRedirectTarget('/book with space')).toBe('/')
  })

  it('rejects a bare path with no leading slash', () => {
    expect(sanitiseRedirectTarget('evil.example')).toBe('/')
  })

  it('honours a caller-supplied fallback', () => {
    expect(sanitiseRedirectTarget('https://evil.example', '/signin')).toBe('/signin')
  })
})
