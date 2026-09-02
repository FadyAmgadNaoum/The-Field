/**
 * API error codes (Doc 11 §3, extended by Doc 24 §K S19j and Doc 23 §2.5).
 *
 * This is the documented catalogue — not an invented one. Codes are stable
 * contract: clients and tests may depend on them. HTTP status is fixed per code
 * so a given code always maps to the same status.
 *
 * Business-specific error classes for these codes are added by the milestone
 * that owns the behaviour (booking conflicts in M3, state transitions in M4).
 * Milestone 0 defines the catalogue and the infrastructure-level classes only.
 */
export const API_ERROR_CODES = {
  /** Request body or params failed Zod validation. Doc 11 §3. */
  VALIDATION_ERROR: 400,
  /** No valid session. Doc 11 §3. */
  UNAUTHORIZED: 401,
  /** Session valid but insufficient permission. Doc 11 §3. */
  FORBIDDEN: 403,
  /** Resource not found — also returned for cross-owner access. Doc 11 §3. */
  NOT_FOUND: 404,
  /** Time slot not available. Doc 11 §3. Raised from M3 onward. */
  BOOKING_CONFLICT: 409,
  /** Same customer re-submitting an identical slot. Doc 24 §K S19j. From M3. */
  DUPLICATE_BOOKING: 409,
  /** Booking/payment status transition not allowed. Doc 11 §3. From M3. */
  STATE_TRANSITION_INVALID: 422,
  /** Too many requests. Doc 11 §3, Doc 24 §I.6. */
  RATE_LIMITED: 429,
  /** Unexpected server error — details logged, never returned. Doc 11 §3. */
  INTERNAL_ERROR: 500,
  /** Database or a required dependency is unavailable. Doc 23 §2.5, REL-M1-T03. */
  SERVICE_UNAVAILABLE: 503,
} as const

export type ApiErrorCode = keyof typeof API_ERROR_CODES

export function httpStatusForCode(code: ApiErrorCode): number {
  return API_ERROR_CODES[code]
}
