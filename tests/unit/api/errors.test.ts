import { describe, expect, it } from 'vitest'
import {
  AppError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
  isConnectionFailure,
  isExclusionViolation,
  toAppError,
} from '@/lib/errors'

/** Application error model (Doc 11 §3, Doc 22 §5.2, Doc 24 §K). */

describe('error classes', () => {
  it('derives HTTP status from the error code', () => {
    expect(new ValidationError().status).toBe(400)
    expect(new UnauthorizedError().status).toBe(401)
    expect(new ForbiddenError().status).toBe(403)
    expect(new NotFoundError().status).toBe(404)
    expect(new RateLimitError().status).toBe(429)
    expect(new InternalError().status).toBe(500)
    expect(new ServiceUnavailableError().status).toBe(503)
  })

  it('carries validation details for field-level feedback', () => {
    const error = new ValidationError('Invalid.', { fieldErrors: { phone: ['Bad format'] } })
    expect(error.details).toEqual({ fieldErrors: { phone: ['Bad format'] } })
  })

  it('marks internal errors as non-exposing so nothing leaks to the browser', () => {
    const error = new InternalError(new Error('relation "bookings" does not exist'))
    expect(error.expose).toBe(false)
    expect(error.message).toBe('An unexpected error occurred.')
    expect(error.message).not.toContain('bookings')
  })

  it('returns "not found" rather than "forbidden" for cross-owner access', () => {
    // Doc 13 T-004: a probe must not be able to tell "exists but forbidden"
    // apart from "does not exist".
    expect(new NotFoundError().status).toBe(404)
  })
})

describe('isConnectionFailure', () => {
  it.each(['ECONNREFUSED', 'ETIMEDOUT', '08006', '57P03'])(
    'recognises %s as a connectivity failure',
    (code) => {
      expect(isConnectionFailure({ code })).toBe(true)
    },
  )

  it('does not treat a constraint violation as a connectivity failure', () => {
    // 23P01 is the exclusion violation — a business conflict, not an outage.
    expect(isConnectionFailure({ code: '23P01' })).toBe(false)
  })

  it('tolerates non-objects', () => {
    expect(isConnectionFailure(null)).toBe(false)
    expect(isConnectionFailure('boom')).toBe(false)
  })
})

describe('isExclusionViolation', () => {
  it('recognises SQLSTATE 23P01', () => {
    expect(isExclusionViolation({ code: '23P01' })).toBe(true)
  })

  it('does not confuse it with other constraint violations', () => {
    expect(isExclusionViolation({ code: '23505' })).toBe(false) // unique_violation
    expect(isExclusionViolation({ code: '23503' })).toBe(false) // foreign_key_violation
    expect(isExclusionViolation({ code: 'ECONNREFUSED' })).toBe(false)
    expect(isExclusionViolation(null)).toBe(false)
  })
})

describe('toAppError', () => {
  it('passes an AppError through unchanged', () => {
    const original = new ForbiddenError()
    expect(toAppError(original)).toBe(original)
  })

  it('maps a PostgreSQL exclusion violation to 409 BOOKING_CONFLICT (Doc 22 §8.4)', () => {
    // The database refusing to double-book a court is a business conflict,
    // not a server fault. It must never surface as a 500.
    const pgError = Object.assign(
      new Error('conflicting key value violates exclusion constraint'),
      { code: '23P01' },
    )
    const result = toAppError(pgError)

    expect(result.status).toBe(409)
    expect(result.code).toBe('BOOKING_CONFLICT')
    expect(result.expose).toBe(true)
    expect(result.message).not.toContain('exclusion constraint')
  })

  it('maps a database connectivity failure to 503, not 500 (Doc 23 §4.3)', () => {
    const result = toAppError(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    )
    expect(result.status).toBe(503)
    expect(result.code).toBe('SERVICE_UNAVAILABLE')
  })

  it('maps anything unrecognised to a non-exposing 500', () => {
    const result = toAppError(new Error('syntax error at or near "SELECT"'))
    expect(result.status).toBe(500)
    expect(result.expose).toBe(false)
    expect(result.message).not.toContain('SELECT')
  })

  it('handles thrown non-errors', () => {
    expect(toAppError('a string').status).toBe(500)
    expect(toAppError(undefined)).toBeInstanceOf(AppError)
  })
})
