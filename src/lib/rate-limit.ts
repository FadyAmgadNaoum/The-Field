import { RateLimiterMemory, type RateLimiterAbstract } from 'rate-limiter-flexible'
import { RateLimitError } from './errors'
import { getClientIp } from './api/request-context'

/**
 * Rate limiting (Doc 11 §7, Doc 22 §5.6, Doc 24 §I.6).
 *
 * In-memory is the correct V1 choice: with one or two instances the limits are
 * approximate, and NGINX enforces a coarser per-IP limit in front regardless
 * (Doc 23 SPOF-08). Redis is a Tier 3 upgrade and is explicitly out of scope —
 * `rate-limiter-flexible` swaps backends behind the same interface when that
 * day comes (Doc 23 §1.3).
 *
 * ── KEYS ─────────────────────────────────────────────────────────────────────
 * Doc 24 §I.6: IP alone for anonymous endpoints; IP AND account for
 * authenticated ones, both of which must pass. IP alone cannot stop one account
 * rotating addresses; account alone cannot stop distributed pre-auth abuse.
 *
 * ── CLIENT IP ────────────────────────────────────────────────────────────────
 * Keys derive from `X-Real-IP`, which NGINX sets from `$remote_addr` AFTER
 * `set_real_ip_from` + `real_ip_header CF-Connecting-IP` have restored the true
 * visitor address (Doc 24 §I.5, nginx/thefield.conf). Client-controlled
 * forwarding headers are never trusted directly.
 */

/** Doc 10 §2.6 — 5 attempts per IP per 15 minutes, then a 15 minute block. */
export const adminLoginLimiter = new RateLimiterMemory({
  points: 5,
  duration: 15 * 60,
  blockDuration: 15 * 60,
})

/** Doc 10 §3.1 — customer login gets the same brute-force protection as admin. */
export const customerLoginIpLimiter = new RateLimiterMemory({
  points: 5,
  duration: 15 * 60,
  blockDuration: 15 * 60,
})

/**
 * Per-account ceiling so a distributed attack on one mailbox is still bounded
 * (Doc 24 §I.6; complements the alert threshold in Doc 16 §8.1).
 */
export const customerLoginAccountLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60 * 60,
})

/** Doc 24 §I.6 — registration, 5 per IP per hour. */
export const customerRegisterLimiter = new RateLimiterMemory({
  points: 5,
  duration: 60 * 60,
})

/** OAuth initiation and callback. Bounds automated churn against Google. */
export const oauthLimiter = new RateLimiterMemory({
  points: 20,
  duration: 15 * 60,
})

/** Doc 11 §7 — all non-login admin routes, 120 per minute per administrator. */
export const adminMutationLimiter = new RateLimiterMemory({
  points: 120,
  duration: 60,
})

/**
 * Key for an anonymous request.
 *
 * When no address can be determined the caller is bucketed under `unknown`.
 * That is deliberately conservative — a shared bucket over-restricts rather
 * than under-restricting. In production NGINX always supplies the header.
 */
export function ipKey(request: Request, scope: string): string {
  return `${scope}:ip:${getClientIp(request) ?? 'unknown'}`
}

export function accountKey(scope: string, identifier: string): string {
  return `${scope}:account:${identifier.toLowerCase()}`
}

/**
 * Consume one point, or throw RateLimitError (429).
 *
 * `rate-limiter-flexible` rejects with a RateLimiterRes rather than an Error;
 * that is normalised here so a limit breach can never surface as an unhandled
 * exception or a 500 (Doc 22 §5.6).
 */
export async function consume(limiter: RateLimiterAbstract, key: string): Promise<void> {
  try {
    await limiter.consume(key, 1)
  } catch (result) {
    if (result instanceof Error) throw result

    const retryAfterSeconds = Math.ceil(
      ((result as { msBeforeNext?: number }).msBeforeNext ?? 60_000) / 1000,
    )
    throw new RateLimitError(`Too many attempts. Please try again in ${retryAfterSeconds} seconds.`)
  }
}

/**
 * Clear a key after a successful login, so honest users are not penalised for
 * a mistyped password earlier in the window (Doc 10 §2.6).
 *
 * Also how tests reset state between cases — each test uses its own IP.
 */
export async function reset(limiter: RateLimiterAbstract, key: string): Promise<void> {
  await limiter.delete(key)
}
