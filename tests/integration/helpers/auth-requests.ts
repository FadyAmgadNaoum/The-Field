import { CSRF_COOKIE, CSRF_HEADER } from '@/lib/auth/csrf-constants'
import { getTestCookieJar } from './cookie-jar'

/**
 * Request builders for the authentication route handlers.
 *
 * Requests carry `x-real-ip` because rate-limit keys derive from it
 * (Doc 24 §I.5). Giving each test its own address keeps counters isolated —
 * without it, one test's failed logins would exhaust the next test's budget.
 */

let ipCounter = 0

/**
 * A unique, VALID IPv4 address per call, so rate-limit buckets never collide.
 *
 * Drawn from the 198.18.0.0/15 benchmarking range (RFC 2544), which gives
 * ~131k distinct addresses — far more than any test run needs.
 */
export function uniqueIp(): string {
  ipCounter += 1
  const third = Math.floor(ipCounter / 254) % 256
  const fourth = (ipCounter % 254) + 1
  return `198.18.${third}.${fourth}`
}

export interface JsonRequestOptions {
  url?: string
  ip?: string
  /** Omit or override the CSRF header to exercise rejection paths. */
  csrf?: string | null
  contentType?: string | null
  headers?: Record<string, string>
}

/**
 * Build a JSON POST carrying a valid CSRF header by default.
 *
 * The token is read from the shared jar, mirroring a browser that loaded a page
 * (or called /api/v1/csrf) before submitting.
 */
export function jsonPost(body: unknown, options: JsonRequestOptions = {}): Request {
  const headers = new Headers(options.headers ?? {})

  if (options.contentType !== null) {
    headers.set('content-type', options.contentType ?? 'application/json')
  }

  if (options.csrf !== null) {
    const token = options.csrf ?? getTestCookieJar().get(CSRF_COOKIE)?.value
    if (token) headers.set(CSRF_HEADER, token)
  }

  headers.set('x-real-ip', options.ip ?? uniqueIp())

  return new Request(options.url ?? 'https://thefield.eg/api/v1/test', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

export function getRequest(options: JsonRequestOptions = {}): Request {
  const headers = new Headers(options.headers ?? {})
  headers.set('x-real-ip', options.ip ?? uniqueIp())
  return new Request(options.url ?? 'https://thefield.eg/api/v1/test', {
    method: 'GET',
    headers,
  })
}

export interface ApiEnvelope<T = unknown> {
  success: boolean
  data?: T
  error?: { code: string; message: string; details?: unknown }
}

export async function readEnvelope<T = unknown>(response: Response): Promise<ApiEnvelope<T>> {
  return (await response.json()) as ApiEnvelope<T>
}

/** Prime the jar with a valid CSRF cookie by calling the real issuing route. */
export async function primeCsrf(): Promise<string> {
  const { GET } = await import('@/app/api/v1/csrf/route')
  const response = await GET(getRequest())
  const body = await readEnvelope<{ csrfToken: string }>(response)
  return body.data!.csrfToken
}
