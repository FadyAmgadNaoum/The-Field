import { REQUEST_ID_HEADER } from './response'

/**
 * Request correlation and client identification (Doc 23 §12.5, Doc 24 §I.5).
 */

/**
 * Read the request id assigned by src/middleware.ts.
 *
 * The middleware is the only component that decides whether an inbound
 * x-request-id may be trusted, so route handlers simply read what it set and
 * fall back to a fresh id if the header is somehow absent.
 */
export function getRequestId(request: Request): string {
  return request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID()
}

/**
 * Resolve the client IP for rate limiting and audit records.
 *
 * IMPORTANT (Doc 24 §I.5): behind Cloudflare, NGINX must be configured with
 * `set_real_ip_from <cloudflare ranges>` and `real_ip_header CF-Connecting-IP`,
 * so that `$remote_addr` — and therefore the `X-Real-IP` header NGINX forwards —
 * holds the true visitor address. Without that configuration every visitor
 * shares one rate-limit bucket. See nginx/thefield.conf.
 *
 * Header precedence:
 *   1. x-real-ip           — set by our own NGINX from the corrected remote addr
 *   2. x-forwarded-for     — first entry, used only if x-real-ip is absent
 *
 * CF-Connecting-IP is deliberately NOT read here. It is attacker-controlled
 * unless it arrives from a Cloudflare range, and that check belongs at the
 * proxy, not in application code.
 */
export function getClientIp(request: Request): string | null {
  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }

  return null
}
