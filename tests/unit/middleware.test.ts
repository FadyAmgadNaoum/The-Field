import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { middleware } from '@/middleware'

/**
 * Security headers and request correlation (Doc 10 §5.5, Doc 22 §6.5,
 * Doc 23 §12.5).
 *
 * Doc 24 §O requires a test that asserts the headers and the CSP nonce appear
 * on a real response — because the documented middleware path in Doc 22 §3
 * (`src/app/middleware.ts`) would never execute, and nothing else would have
 * caught it.
 */

function request(url = 'https://thefield.eg/', headers: Record<string, string> = {}) {
  return new NextRequest(new Request(url, { headers }))
}

describe('security headers', () => {
  it('sets every documented header', () => {
    const response = middleware(request())

    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(response.headers.get('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=()',
    )
    expect(response.headers.get('Content-Security-Policy')).toBeTruthy()
  })

  it('denies framing and restricts form submission and base URI', () => {
    const csp = middleware(request()).headers.get('Content-Security-Policy') ?? ''
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("default-src 'self'")
  })

  it('issues a fresh CSP nonce on every request', () => {
    const first = middleware(request()).headers.get('x-nonce')
    const second = middleware(request()).headers.get('x-nonce')

    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(first).not.toBe(second)
  })
})

describe('request correlation', () => {
  it('sets an x-request-id on every response', () => {
    const requestId = middleware(request()).headers.get('x-request-id')
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('generates a fresh id for each request', () => {
    const a = middleware(request()).headers.get('x-request-id')
    const b = middleware(request()).headers.get('x-request-id')
    expect(a).not.toBe(b)
  })

  it('ignores a client-supplied request id that did not come through the proxy', () => {
    // Without x-real-ip the request did not traverse our NGINX, so an inbound
    // correlation id is attacker-controlled and must not be trusted into logs.
    const response = middleware(request('https://thefield.eg/', { 'x-request-id': 'forged-id' }))
    expect(response.headers.get('x-request-id')).not.toBe('forged-id')
  })

  it('honours a request id forwarded by the proxy', () => {
    const response = middleware(
      request('https://thefield.eg/', {
        'x-request-id': 'edge-trace-123',
        'x-real-ip': '41.0.0.7',
      }),
    )
    expect(response.headers.get('x-request-id')).toBe('edge-trace-123')
  })

  it('rejects a malformed proxied request id rather than logging junk', () => {
    const response = middleware(
      request('https://thefield.eg/', {
        'x-request-id': 'has spaces and <script>',
        'x-real-ip': '41.0.0.7',
      }),
    )
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/i)
  })
})
