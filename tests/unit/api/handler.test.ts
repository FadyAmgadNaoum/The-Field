import { describe, expect, it } from 'vitest'
import { assertJsonContentType, withApiHandler } from '@/lib/api/handler'
import { apiSuccess } from '@/lib/api/response'
import { ForbiddenError, ValidationError } from '@/lib/errors'

/** Centralised route wrapper (Doc 22 §5.2, Doc 24 §K). */

function request(init: RequestInit = {}) {
  return new Request('https://thefield.eg/api/v1', init)
}

describe('withApiHandler', () => {
  it('passes a successful response through unchanged', async () => {
    const handler = withApiHandler(async (_req, { requestId }) =>
      apiSuccess({ ok: true }, { requestId }),
    )
    const response = await handler(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, data: { ok: true } })
  })

  it('always attaches a request id, even when none arrived', async () => {
    const handler = withApiHandler(async (_req, { requestId }) => apiSuccess({}, { requestId }))
    expect((await handler(request())).headers.get('x-request-id')).toBeTruthy()
  })

  it('maps a thrown AppError to its documented code and status', async () => {
    const handler = withApiHandler(async () => {
      throw new ForbiddenError()
    })
    const response = await handler(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    })
  })

  it('surfaces validation details for field-level feedback', async () => {
    const handler = withApiHandler(async () => {
      throw new ValidationError('Invalid.', { fieldErrors: { date: ['Required'] } })
    })
    const body = (await (await handler(request())).json()) as { error: { details: unknown } }

    expect(body.error.details).toEqual({ fieldErrors: { date: ['Required'] } })
  })

  it('converts an unexpected error into a 500 that leaks nothing', async () => {
    const handler = withApiHandler(async () => {
      throw new Error('relation "bookings" does not exist at character 15')
    })
    const response = await handler(request())
    const body = JSON.stringify(await response.json())

    expect(response.status).toBe(500)
    expect(body).not.toContain('bookings')
    expect(body).not.toContain('character 15')
    expect(body).toContain('An unexpected error occurred.')
  })

  it('maps a database connectivity failure to 503, not 500', async () => {
    const handler = withApiHandler(async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    })
    const response = await handler(request())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SERVICE_UNAVAILABLE' },
    })
  })

  it('never throws out of the wrapper', async () => {
    const handler = withApiHandler(async () => {
      throw 'a bare string'
    })
    await expect(handler(request())).resolves.toBeDefined()
  })
})

describe('assertJsonContentType', () => {
  it('accepts application/json', () => {
    expect(() =>
      assertJsonContentType(request({ headers: { 'content-type': 'application/json' } })),
    ).not.toThrow()
  })

  it('accepts a charset parameter', () => {
    expect(() =>
      assertJsonContentType(
        request({ headers: { 'content-type': 'application/json; charset=utf-8' } }),
      ),
    ).not.toThrow()
  })

  it('rejects the content types a cross-origin HTML form can send', () => {
    // Doc 10 §5.4 / Doc 24 §E.4 — this is the secondary CSRF control.
    for (const contentType of [
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'text/plain',
    ]) {
      expect(() =>
        assertJsonContentType(request({ headers: { 'content-type': contentType } })),
      ).toThrow(ValidationError)
    }
  })

  it('rejects a missing content type', () => {
    expect(() => assertJsonContentType(request())).toThrow(ValidationError)
  })
})
