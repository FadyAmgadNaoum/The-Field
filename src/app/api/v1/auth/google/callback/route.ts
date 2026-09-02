import { NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api/handler'
import { apiError } from '@/lib/api/response'
import { establishCustomerSession } from '@/lib/auth/customer-session'
import { clearOAuthCookies, completeAuthorization, isGoogleConfigured } from '@/lib/auth/google'
import { consume, ipKey, oauthLimiter } from '@/lib/rate-limit'
import * as customers from '@/modules/customers/customers.service'

/**
 * Google Sign-In callback (Doc 24 §E.2).
 *
 * Security properties:
 *   - `state` must match the cookie set at /start, or the request is rejected
 *     403 before any token exchange happens. This is the OAuth CSRF control.
 *   - the PKCE verifier never leaves the server.
 *   - the redirect destination comes from the cookie written at /start, already
 *     reduced to a same-origin relative path — never from a callback parameter.
 *   - the one-time cookies are cleared on every path, success or failure, so a
 *     state value cannot be replayed.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withApiHandler(async (request, { requestId }) => {
  await consume(oauthLimiter, ipKey(request, 'oauth-callback'))

  if (!isGoogleConfigured()) {
    return apiError('SERVICE_UNAVAILABLE', 'Google Sign-In is not configured.', { requestId })
  }

  const params = new URL(request.url).searchParams

  try {
    const { identity, redirectTarget } = await completeAuthorization(
      params.get('code'),
      params.get('state'),
    )

    const profile = await customers.upsertFromGoogle(identity)
    await establishCustomerSession({ id: profile.id, email: profile.email })

    return NextResponse.redirect(new URL(redirectTarget, request.url), { status: 302 })
  } finally {
    clearOAuthCookies()
  }
})
