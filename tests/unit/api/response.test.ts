import { describe, expect, it } from 'vitest'
import { apiError, apiPaginated, apiSuccess, buildPagination } from '@/lib/api/response'
import { API_ERROR_CODES, httpStatusForCode } from '@/lib/api/error-codes'

/** Response envelope contract (Doc 11 §2, Doc 22 §5.1). */

describe('apiSuccess', () => {
  it('wraps data in the documented success envelope', async () => {
    const response = apiSuccess({ api: 'thefield', version: 'v1' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { api: 'thefield', version: 'v1' },
    })
  })

  it('honours an explicit status such as 201', () => {
    expect(apiSuccess({ id: 1 }, { status: 201 }).status).toBe(201)
  })

  it('echoes the request id so a response can be correlated with the logs', () => {
    const response = apiSuccess({}, { requestId: 'req-abc' })
    expect(response.headers.get('x-request-id')).toBe('req-abc')
  })

  it('marks every API response as uncacheable', () => {
    expect(apiSuccess({}).headers.get('Cache-Control')).toContain('no-store')
  })
})

describe('apiPaginated', () => {
  it('returns the documented items + pagination shape', async () => {
    const response = apiPaginated(['a', 'b'], buildPagination(1, 25, 142))
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        items: ['a', 'b'],
        pagination: { page: 1, pageSize: 25, total: 142, totalPages: 6 },
      },
    })
  })
})

describe('buildPagination', () => {
  it('rounds the page count up', () => {
    expect(buildPagination(1, 25, 142).totalPages).toBe(6)
    expect(buildPagination(1, 25, 25).totalPages).toBe(1)
    expect(buildPagination(1, 25, 0).totalPages).toBe(0)
  })
})

describe('apiError', () => {
  it('wraps the failure in the documented error envelope', async () => {
    const response = apiError('VALIDATION_ERROR', 'The submitted data is not valid.')
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'The submitted data is not valid.' },
    })
  })

  it('omits details entirely when none are supplied', async () => {
    const body = (await apiError('NOT_FOUND', 'Nope.').json()) as {
      error: Record<string, unknown>
    }
    expect('details' in body.error).toBe(false)
  })

  it('includes field-level details when supplied', async () => {
    const response = apiError('VALIDATION_ERROR', 'Invalid.', {
      details: { fieldErrors: { date: ['Required'] } },
    })
    const body = (await response.json()) as { error: { details: unknown } }
    expect(body.error.details).toEqual({ fieldErrors: { date: ['Required'] } })
  })
})

describe('error code catalogue', () => {
  it('maps each documented code to its documented HTTP status (Doc 11 §3)', () => {
    expect(httpStatusForCode('VALIDATION_ERROR')).toBe(400)
    expect(httpStatusForCode('UNAUTHORIZED')).toBe(401)
    expect(httpStatusForCode('FORBIDDEN')).toBe(403)
    expect(httpStatusForCode('NOT_FOUND')).toBe(404)
    expect(httpStatusForCode('BOOKING_CONFLICT')).toBe(409)
    expect(httpStatusForCode('DUPLICATE_BOOKING')).toBe(409)
    expect(httpStatusForCode('STATE_TRANSITION_INVALID')).toBe(422)
    expect(httpStatusForCode('RATE_LIMITED')).toBe(429)
    expect(httpStatusForCode('INTERNAL_ERROR')).toBe(500)
    expect(httpStatusForCode('SERVICE_UNAVAILABLE')).toBe(503)
  })

  it('contains exactly the documented codes and no invented ones', () => {
    expect(Object.keys(API_ERROR_CODES).sort()).toEqual(
      [
        'BOOKING_CONFLICT',
        'DUPLICATE_BOOKING',
        'FORBIDDEN',
        'INTERNAL_ERROR',
        'NOT_FOUND',
        'RATE_LIMITED',
        'SERVICE_UNAVAILABLE',
        'STATE_TRANSITION_INVALID',
        'UNAUTHORIZED',
        'VALIDATION_ERROR',
      ].sort(),
    )
  })
})
