import { describe, expect, it } from 'vitest'
import { EnvironmentValidationError, parseDatabaseEnv, parseServerEnv } from '@/lib/config/env'

/**
 * Environment validation (Doc 22 M0-T07, Doc 23 REL-M1-T04, Doc 24 §I.4).
 */

const VALID: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  VENUE_ID: '11111111-2222-4333-8444-555555555555',
  SESSION_SECRET: 'a'.repeat(64),
  DATABASE_URL: 'postgresql://app_user:secret@127.0.0.1:5432/thefield',
  STORAGE_PROVIDER: 's3',
  BOOKING_EXPIRY_MINUTES: '120',
  NEXT_PUBLIC_SITE_URL: 'https://thefield.eg',
  // Required in production once customer authentication exists (Doc 23 REL-M1-T04).
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_REDIRECT_URI: 'https://thefield.eg/api/v1/auth/google/callback',
}

describe('parseServerEnv', () => {
  it('accepts a complete configuration', () => {
    const env = parseServerEnv(VALID)
    expect(env.VENUE_ID).toBe(VALID.VENUE_ID)
    expect(env.BOOKING_EXPIRY_MINUTES).toBe(120)
    expect(env.DB_POOL_MAX).toBe(10)
    expect(env.DB_POOL_MIN).toBe(2)
  })

  it.each([
    ['VENUE_ID', 'VENUE_ID'],
    ['SESSION_SECRET', 'SESSION_SECRET'],
    ['DATABASE_URL', 'DATABASE_URL'],
    ['STORAGE_PROVIDER', 'STORAGE_PROVIDER'],
    ['BOOKING_EXPIRY_MINUTES', 'BOOKING_EXPIRY_MINUTES'],
  ])('rejects a configuration missing %s', (variable, expectedInMessage) => {
    const source = { ...VALID }
    delete source[variable]
    expect(() => parseServerEnv(source)).toThrow(EnvironmentValidationError)
    try {
      parseServerEnv(source)
    } catch (error) {
      expect((error as Error).message).toContain(expectedInMessage)
    }
  })

  it('rejects a SESSION_SECRET shorter than 32 characters', () => {
    expect(() => parseServerEnv({ ...VALID, SESSION_SECRET: 'too-short' })).toThrow(
      /at least 32 characters/,
    )
  })

  it('rejects a VENUE_ID that is not a UUID', () => {
    expect(() => parseServerEnv({ ...VALID, VENUE_ID: 'the-field' })).toThrow(/VENUE_ID/)
  })

  it('rejects a non-PostgreSQL DATABASE_URL', () => {
    expect(() => parseServerEnv({ ...VALID, DATABASE_URL: 'mysql://host/db' })).toThrow(
      /PostgreSQL connection string/,
    )
  })

  it('never invents a BOOKING_EXPIRY_MINUTES default — OBD-002 is unresolved', () => {
    const source = { ...VALID }
    delete source.BOOKING_EXPIRY_MINUTES
    expect(() => parseServerEnv(source)).toThrow(/BOOKING_EXPIRY_MINUTES/)
  })

  it('rejects a non-numeric BOOKING_EXPIRY_MINUTES', () => {
    expect(() => parseServerEnv({ ...VALID, BOOKING_EXPIRY_MINUTES: 'two hours' })).toThrow(
      /whole number/,
    )
  })

  it('rejects local storage in production — proofs must never sit on the VPS disk', () => {
    expect(() => parseServerEnv({ ...VALID, STORAGE_PROVIDER: 'local' })).toThrow(
      /STORAGE_PROVIDER must be 's3' in production/,
    )
  })

  it('allows local storage outside production', () => {
    const env = parseServerEnv({ ...VALID, NODE_ENV: 'development', STORAGE_PROVIDER: 'local' })
    expect(env.STORAGE_PROVIDER).toBe('local')
  })

  it('requires NEXT_PUBLIC_SITE_URL in production', () => {
    const source = { ...VALID }
    delete source.NEXT_PUBLIC_SITE_URL
    expect(() => parseServerEnv(source)).toThrow(/NEXT_PUBLIC_SITE_URL/)
  })

  it.each(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'])(
    'requires %s in production — Google Sign-In is part of the V1 booking flow',
    (variable) => {
      const source = { ...VALID }
      delete source[variable]
      expect(() => parseServerEnv(source)).toThrow(new RegExp(variable))
    },
  )

  it('allows Google credentials to be absent outside production', () => {
    // A developer or CI job without an OAuth client must still be able to boot;
    // the OAuth routes return a controlled 503 instead.
    const source: NodeJS.ProcessEnv = { ...VALID, NODE_ENV: 'development' }
    delete source.GOOGLE_CLIENT_ID
    delete source.GOOGLE_CLIENT_SECRET
    delete source.GOOGLE_REDIRECT_URI
    expect(() => parseServerEnv(source)).not.toThrow()
  })

  it('accepts the silent log level used by test suites', () => {
    expect(parseServerEnv({ ...VALID, LOG_LEVEL: 'silent' }).LOG_LEVEL).toBe('silent')
  })

  it('rejects a pool minimum larger than the maximum', () => {
    expect(() => parseServerEnv({ ...VALID, DB_POOL_MAX: '2', DB_POOL_MIN: '10' })).toThrow(
      /DB_POOL_MIN must not exceed DB_POOL_MAX/,
    )
  })

  it('reports every problem at once rather than one at a time', () => {
    const error = (() => {
      try {
        parseServerEnv({ NODE_ENV: 'production' })
        return null
      } catch (caught) {
        return caught as EnvironmentValidationError
      }
    })()

    expect(error).toBeInstanceOf(EnvironmentValidationError)
    expect(error?.issues.length).toBeGreaterThan(3)
  })
})

describe('parseDatabaseEnv', () => {
  it('does not require VENUE_ID, because the seed creates the venue', () => {
    const env = parseDatabaseEnv({
      NODE_ENV: 'development',
      DATABASE_URL: VALID.DATABASE_URL,
    })
    expect(env.DATABASE_URL).toBe(VALID.DATABASE_URL)
  })

  it('still requires DATABASE_URL', () => {
    expect(() => parseDatabaseEnv({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL/)
  })
})
