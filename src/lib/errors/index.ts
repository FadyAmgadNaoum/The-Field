import { type ApiErrorCode, httpStatusForCode } from '../api/error-codes'

/**
 * Application error model (Doc 11 §3, Doc 22 §5.2, Doc 24 §K).
 *
 * Every error that reaches a client carries:
 *  - a stable machine-readable `code`
 *  - a fixed HTTP status derived from that code
 *  - a message that is safe to display
 *
 * Internal diagnostic detail travels in `cause` and in the structured log. It
 * is never serialised into a response. Stack traces and database internals must
 * not reach the browser (Doc 02 FR-SEC-013, Doc 03 NFR-AVAIL-006).
 */
export class AppError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  /** Safe to serialise. Must not contain internal identifiers or SQL. */
  readonly details?: unknown
  /** True when the message was written for an end user. */
  readonly expose: boolean

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { details?: unknown; cause?: unknown; expose?: boolean } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = new.target.name
    this.code = code
    this.status = httpStatusForCode(code)
    this.details = options.details
    this.expose = options.expose ?? true
    Error.captureStackTrace?.(this, new.target)
  }
}

/** 400 — request failed schema validation. `details` carries field errors. */
export class ValidationError extends AppError {
  constructor(message = 'The submitted data is not valid.', details?: unknown) {
    super('VALIDATION_ERROR', message, { details })
  }
}

/** 401 — no valid session. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication is required.') {
    super('UNAUTHORIZED', message)
  }
}

/** 403 — authenticated but not permitted. */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super('FORBIDDEN', message)
  }
}

/**
 * 404 — not found.
 *
 * Also returned when a caller requests a resource they do not own, so that a
 * probe cannot distinguish "exists but forbidden" from "does not exist"
 * (Doc 13 T-004, Doc 10 §3.5).
 */
export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.') {
    super('NOT_FOUND', message)
  }
}

/**
 * 409 — the requested slot is already taken.
 *
 * Raised when PostgreSQL rejects an overlapping approved booking with
 * SQLSTATE 23P01, and by the application's own pre-flight conflict check from
 * Milestone 3 onward (Doc 22 §8.4, Doc 11 §3).
 */
export class BookingConflictError extends AppError {
  constructor(
    message = 'This time slot is no longer available.',
    options: { details?: unknown; cause?: unknown } = {},
  ) {
    super('BOOKING_CONFLICT', message, options)
  }
}

/** 429 — rate limit exceeded. Never thrown as an unhandled error (Doc 22 §5.6). */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please wait a moment and try again.') {
    super('RATE_LIMITED', message)
  }
}

/**
 * 503 — a required dependency is unavailable.
 *
 * Doc 23 §4.3: a database outage must produce a controlled 503 with a
 * customer-safe message, never a 500 and never a silent success.
 */
export class ServiceUnavailableError extends AppError {
  constructor(
    message = 'The service is temporarily unavailable. Please try again in a moment.',
    cause?: unknown,
  ) {
    super('SERVICE_UNAVAILABLE', message, { cause })
  }
}

/** 500 — unexpected. The real message is logged, never returned. */
export class InternalError extends AppError {
  constructor(cause?: unknown) {
    super('INTERNAL_ERROR', 'An unexpected error occurred.', { cause, expose: false })
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * PostgreSQL SQLSTATE codes that mean "the database is not reachable or not
 * accepting work". These map to 503, not 500 (Doc 23 REL-M1-T03).
 */
const CONNECTION_FAILURE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
])

export function isConnectionFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && CONNECTION_FAILURE_CODES.has(code)
}

/** PostgreSQL `exclusion_violation`. */
const EXCLUSION_VIOLATION = '23P01'

/**
 * True when PostgreSQL rejected the write because of an exclusion constraint —
 * in this system, always `no_overlapping_approved_bookings`.
 *
 * This is the database refusing to double-book a court. It is a business
 * conflict, not a server fault, and must surface as HTTP 409 rather than 500
 * (Doc 22 §8.4, Doc 06 §9).
 */
export function isExclusionViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  return (error as { code?: unknown }).code === EXCLUSION_VIOLATION
}

/**
 * Normalise any thrown value into an AppError.
 *
 * Connection failures become 503; everything unrecognised becomes a
 * non-exposing 500 so that no internal message can leak.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error
  if (isExclusionViolation(error)) return new BookingConflictError(undefined, { cause: error })
  if (isConnectionFailure(error)) return new ServiceUnavailableError(undefined, error)
  return new InternalError(error)
}
