import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { ForbiddenError } from '../errors'
import { getSessionSecret, isProduction } from '../config'

/**
 * CSRF protection (Doc 10 §5.4, Doc 13 T-003, Doc 24 §E.4).
 *
 * Layered, exactly as the specification describes:
 *
 *   1. `SameSite=Lax` on both session cookies — the primary control. A browser
 *      does not attach them to a cross-site POST.
 *   2. `Content-Type: application/json` on mutations (see api/handler.ts) — an
 *      HTML form cannot set that header cross-origin.
 *   3. This token, for browser-submitted forms.
 *
 * `X-Requested-With` is deliberately NOT used: `fetch` does not send it and
 * proxies strip it, so it produces false failures without adding protection
 * (Doc 10 §5.4, Doc 24 §E.4 — corrects the claim in Doc 13 T-003).
 *
 * Design: signed double-submit. The cookie holds `<random>.<hmac>`; the request
 * echoes it in the `x-csrf-token` header. The cookie stays HttpOnly — the token
 * reaches the form by being rendered into the page server-side, so no script
 * needs to read it. The HMAC means a token cannot be forged even by a
 * subdomain that can write cookies.
 */

export { CSRF_COOKIE, CSRF_HEADER } from './csrf-constants'

import { CSRF_COOKIE, CSRF_HEADER } from './csrf-constants'

const TOKEN_BYTES = 32

function sign(value: string): string {
  return createHmac('sha256', getSessionSecret()).update(value).digest('base64url')
}

export function createCsrfToken(): string {
  const value = randomBytes(TOKEN_BYTES).toString('base64url')
  return `${value}.${sign(value)}`
}

/** Structural + signature validation. Rejects anything not minted by us. */
export function isValidCsrfToken(token: string | undefined | null): boolean {
  if (!token) return false
  const separator = token.lastIndexOf('.')
  if (separator <= 0) return false

  const value = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  const expected = sign(value)

  if (signature.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Return the current CSRF token, minting and setting one if absent.
 *
 * ROUTE HANDLERS AND SERVER ACTIONS ONLY. Next.js forbids setting a cookie
 * during a page render and throws if you try, so a server component must not
 * call this — forms fetch their token from GET /api/v1/csrf instead
 * (src/components/admin/csrf-client.ts).
 */
export function getOrCreateCsrfToken(): string {
  const store = cookies()
  const existing = store.get(CSRF_COOKIE)?.value

  if (existing && isValidCsrfToken(existing)) return existing

  const token = createCsrfToken()
  store.set(CSRF_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    // Outlives a long form-filling session without becoming permanent.
    maxAge: 60 * 60 * 12,
  })
  return token
}

/**
 * Verify the submitted token against the cookie. Throws ForbiddenError (403).
 *
 * Both must be present, both must carry a valid signature, and they must match.
 */
export function assertCsrfToken(request: Request): void {
  const submitted = request.headers.get(CSRF_HEADER)
  const stored = cookies().get(CSRF_COOKIE)?.value

  if (!submitted || !stored) {
    throw new ForbiddenError('Missing CSRF token. Reload the page and try again.')
  }
  if (!isValidCsrfToken(submitted) || !isValidCsrfToken(stored)) {
    throw new ForbiddenError('Invalid CSRF token. Reload the page and try again.')
  }
  if (!constantTimeEquals(submitted, stored)) {
    throw new ForbiddenError('CSRF token mismatch. Reload the page and try again.')
  }
}
