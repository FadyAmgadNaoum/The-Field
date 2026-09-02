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
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/
const IPV6 = /^[0-9a-f:]+$/i

/**
 * Accept only something that is actually an IP address.
 *
 * The value ends up in `inet` columns (`admin_users.last_login_ip`,
 * `bookings.ip_address`), where PostgreSQL rejects malformed input with a
 * syntax error. Without this guard a bad header — from a misconfigured proxy or
 * a spoofing attempt — would turn a valid sign-in into a 500.
 */
function isIpAddress(value: string): boolean {
  if (IPV4.test(value)) {
    return value.split('.').every((octet) => Number(octet) <= 255)
  }
  return value.includes(':') && IPV6.test(value)
}

export function getClientIp(request: Request): string | null {
  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp && isIpAddress(realIp)) return realIp

  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first && isIpAddress(first)) return first
  }

  return null
}
