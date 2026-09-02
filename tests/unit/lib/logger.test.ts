import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { REDACT_PATHS } from '@/lib/logger'

/**
 * Log redaction (Doc 13 T-018, Doc 16 §5.1, Doc 23 §12.4).
 *
 * Doc 13 treats customer phone numbers, credentials and internal storage keys
 * appearing in logs as an information-disclosure vulnerability. This exercises
 * the real redaction configuration against a captured stream.
 */

function captureLog(payload: Record<string, unknown>): Record<string, unknown> {
  let captured = ''
  const stream = {
    write(chunk: string) {
      captured += chunk
    },
  }

  const logger = pino(
    { level: 'info', redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } },
    stream as unknown as pino.DestinationStream,
  )

  logger.info(payload, 'test message')
  return JSON.parse(captured) as Record<string, unknown>
}

describe('sensitive field redaction', () => {
  it('redacts a customer phone number at the top level', () => {
    expect(captureLog({ customerPhone: '01012345678' }).customerPhone).toBe('[REDACTED]')
  })

  it('redacts a phone number nested inside a booking payload', () => {
    const line = captureLog({ booking: { customerPhone: '01012345678', court: 'Court 1' } })
    const booking = line.booking as Record<string, unknown>
    expect(booking.customerPhone).toBe('[REDACTED]')
    expect(booking.court).toBe('Court 1')
  })

  it.each([
    'password',
    'passwordHash',
    'password_hash',
    'SESSION_SECRET',
    'DATABASE_URL',
    'S3_SECRET_ACCESS_KEY',
    'GOOGLE_CLIENT_SECRET',
  ])('redacts %s', (field) => {
    expect(captureLog({ [field]: 'super-secret-value' })[field]).toBe('[REDACTED]')
  })

  it('redacts the snake_case phone column name used by the database', () => {
    expect(captureLog({ phone_number: '01012345678' }).phone_number).toBe('[REDACTED]')
  })

  it('redacts internal storage keys so proof locations never reach a log', () => {
    expect(captureLog({ storageKey: 'proofs/abc/def.jpg' }).storageKey).toBe('[REDACTED]')
    expect(captureLog({ storage_key: 'proofs/abc/def.jpg' }).storage_key).toBe('[REDACTED]')
  })

  it('redacts the session cookie from request headers', () => {
    const line = captureLog({ req: { headers: { cookie: 'thefield_admin_session=abc' } } })
    const req = line.req as { headers: Record<string, unknown> }
    expect(req.headers.cookie).toBe('[REDACTED]')
  })

  it('leaves non-sensitive operational fields intact', () => {
    const line = captureLog({
      bookingReference: 'TF-20260905-K7M2',
      requestId: 'req-1',
      courtId: 'court-uuid',
      status: 'approved',
    })
    expect(line.bookingReference).toBe('TF-20260905-K7M2')
    expect(line.requestId).toBe('req-1')
    expect(line.status).toBe('approved')
  })
})
