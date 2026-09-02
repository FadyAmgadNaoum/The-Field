import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError, postJson } from '@/lib/ui/api-client'

/**
 * Browser API client (Doc 11 §2–3, Doc 24 §E.4).
 *
 * Two properties are under test:
 *
 *  1. Every mutation carries a CSRF token and the JSON content type. Losing
 *     either would produce a 403 from every form, which is the kind of thing
 *     that gets "fixed" by weakening the server check.
 *  2. A failure is normalised to the server's own code — the client never
 *     guesses meaning from a status code and never surfaces a raw body.
 */

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const CSRF_OK = { success: true, data: { csrfToken: 'token-abc' } }

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('postJson', () => {
  it('sends the CSRF token and JSON content type', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = []

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      if (String(input).includes('/api/v1/csrf')) return jsonResponse(CSRF_OK)
      return jsonResponse({ success: true, data: { ok: true } })
    }) as typeof fetch

    await postJson('/api/v1/booking-status', { reference: 'TF-20260910-A2K9' })

    const mutation = calls[1]
    expect(mutation?.url).toBe('/api/v1/booking-status')

    const headers = new Headers(mutation?.init?.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-csrf-token')).toBe('token-abc')
    expect(mutation?.init?.method).toBe('POST')
  })

  it('fetches a fresh token for every request', async () => {
    // The token is minted immediately before the request rather than on mount,
    // so a form left open for hours cannot fail on a stale one.
    let csrfCalls = 0

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/v1/csrf')) {
        csrfCalls += 1
        return jsonResponse(CSRF_OK)
      }
      return jsonResponse({ success: true, data: {} })
    }) as typeof fetch

    await postJson('/x', {})
    await postJson('/x', {})

    expect(csrfCalls).toBe(2)
  })

  it('returns the data envelope contents on success', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/v1/csrf')) return jsonResponse(CSRF_OK)
      return jsonResponse({ success: true, data: { booking: { reference: 'TF-1' } } })
    }) as typeof fetch

    const result = await postJson<{ booking: { reference: string } }>('/x', {})
    expect(result.booking.reference).toBe('TF-1')
  })

  it('surfaces the server error code rather than guessing from the status', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/v1/csrf')) return jsonResponse(CSRF_OK)
      return jsonResponse(
        { success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts.' } },
        429,
      )
    }) as typeof fetch

    await expect(postJson('/x', {})).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      message: 'Too many attempts.',
    })
  })

  it('exposes field errors for form display', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/v1/csrf')) return jsonResponse(CSRF_OK)
      return jsonResponse(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid.',
            details: { fieldErrors: { email: ['Enter a valid email address.'] } },
          },
        },
        400,
      )
    }) as typeof fetch

    try {
      await postJson('/x', {})
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError)
      expect((error as ApiRequestError).fieldError('email')).toBe('Enter a valid email address.')
      expect((error as ApiRequestError).fieldError('password')).toBeUndefined()
    }
  })

  it('treats a non-JSON response as an internal error rather than leaking the body', async () => {
    // If a proxy returns an HTML error page, none of it should reach the UI.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/v1/csrf')) return jsonResponse(CSRF_OK)
      return new Response('<html>Gateway Timeout</html>', { status: 504 })
    }) as typeof fetch

    const error = await postJson('/x', {}).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiRequestError)
    expect((error as ApiRequestError).code).toBe('INTERNAL_ERROR')
    // The upstream body must not reach the message the customer sees.
    expect((error as ApiRequestError).message).not.toMatch(/html|gateway/i)
  })

  it('distinguishes a transport failure from a server error', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch

    await expect(postJson('/x', {})).rejects.toMatchObject({ code: 'NETWORK', status: 0 })
  })

  it('fails cleanly when the CSRF endpoint is unavailable', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ success: false, error: { code: 'SERVICE_UNAVAILABLE' } }, 503),
    ) as typeof fetch

    await expect(postJson('/x', {})).rejects.toBeInstanceOf(ApiRequestError)
  })
})
