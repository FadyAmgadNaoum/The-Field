import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Security headers, CSP nonce and request correlation.
 *
 * LOCATION IS LOAD-BEARING: Next.js only detects middleware at `src/middleware.ts`
 * or the project root. Doc 22 §3/§6.5 place it at `src/app/middleware.ts`, where
 * it would never execute — silently disabling every header below while tests
 * that inspect the app router would still pass. Doc 24 §C.2 corrects this.
 *
 * This file runs on the Edge runtime. It must not import the config module, the
 * logger, or anything that touches `pg` — those are Node-only.
 *
 * Header set: Doc 10 §5.5, Doc 22 §6.5. NGINX re-applies a subset at the edge as
 * belt-and-suspenders (Doc 22 §14.5); duplication here is intentional so the
 * application is not dependent on proxy configuration for its baseline posture.
 */

const REQUEST_ID_HEADER = 'x-request-id'
const NONCE_HEADER = 'x-nonce'

function buildContentSecurityPolicy(nonce: string, isDevelopment: boolean): string {
  // Next.js development mode requires eval for React Refresh and injects inline
  // bootstrap scripts. Production uses a strict nonce-based policy.
  // This relaxation is scoped to NODE_ENV=development only — the production
  // posture is never weakened for developer convenience (Doc 24 §M item 21).
  const scriptSrc = isDevelopment
    ? "'self' 'unsafe-eval' 'unsafe-inline'"
    : `'self' 'nonce-${nonce}'`

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind injects styles inline; documented and accepted (Doc 22 §13.3).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

const ADMIN_SESSION_COOKIE = 'thefield_admin_session'

/** Admin paths reachable without a session. */
const UNGUARDED_ADMIN_PATHS = ['/admin/login']

/**
 * Cheap redirect for admin pages with no session cookie.
 *
 * THIS IS NOT THE SECURITY BOUNDARY. It only checks that a cookie is PRESENT —
 * it does not decrypt it, verify the signature, or consult the database, and it
 * cannot: middleware runs on the Edge runtime where `pg` is unavailable.
 *
 * The authoritative checks are the server component guard in
 * `src/app/admin/(dashboard)/layout.tsx` and the independent check inside every
 * admin API route (Doc 22 §11.2, Doc 24 §M item 15). A forged cookie gets past
 * this function and is rejected microseconds later by the real check.
 *
 * Its only job is to spare a signed-out administrator a pointless render.
 */
function buildResponse(request: NextRequest, forwardedHeaders: Headers): NextResponse {
  const { pathname } = request.nextUrl

  const isGuardedAdminPage =
    pathname.startsWith('/admin') &&
    !UNGUARDED_ADMIN_PATHS.some(
      (allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`),
    )

  if (isGuardedAdminPage && !request.cookies.has(ADMIN_SESSION_COOKIE)) {
    const target = new URL('/admin/login', request.url)
    return NextResponse.redirect(target)
  }

  return NextResponse.next({ request: { headers: forwardedHeaders } })
}

export function middleware(request: NextRequest): NextResponse {
  const isDevelopment = process.env.NODE_ENV === 'development'
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  /**
   * Request id (Doc 23 §12.5).
   *
   * An inbound x-request-id is only trusted when it arrives through our own
   * proxy chain, which is the only path that sets x-real-ip. A direct client
   * request cannot forge correlation ids into our logs. Doc 23 REL-M0-T05's
   * trust rule is garbled in the source; Doc 24 §K S19g records this reading.
   */
  const inboundRequestId = request.headers.get(REQUEST_ID_HEADER)
  const cameThroughProxy = request.headers.has('x-real-ip')
  const requestId =
    inboundRequestId && cameThroughProxy && /^[\w-]{1,128}$/.test(inboundRequestId)
      ? inboundRequestId
      : crypto.randomUUID()

  // Forward the id and nonce to the application (route handlers and RSC read
  // these from the incoming headers).
  const forwardedHeaders = new Headers(request.headers)
  forwardedHeaders.set(REQUEST_ID_HEADER, requestId)
  forwardedHeaders.set(NONCE_HEADER, nonce)

  const response = buildResponse(request, forwardedHeaders)

  response.headers.set(REQUEST_ID_HEADER, requestId)
  response.headers.set(NONCE_HEADER, nonce)

  // Doc 10 §5.5 / Doc 22 §6.5
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.headers.set('Content-Security-Policy', buildContentSecurityPolicy(nonce, isDevelopment))

  // HSTS is only meaningful over TLS. Setting it on plaintext development
  // traffic would pin localhost to HTTPS in the developer's browser.
  // Production terminates TLS at Cloudflare and NGINX, both of which also set
  // this header (Doc 22 §14.5, Doc 23 §13.1).
  if (!isDevelopment) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    )
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Every route except Next.js internals and static assets.
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
}
