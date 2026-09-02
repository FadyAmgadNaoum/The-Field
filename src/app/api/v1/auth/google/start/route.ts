import { NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api/handler'
import { apiError } from '@/lib/api/response'
import {
  createAuthorizationRequest,
  isGoogleConfigured,
  sanitiseRedirectTarget,
} from '@/lib/auth/google'
import { consume, ipKey, oauthLimiter } from '@/lib/rate-limit'

/**
 * Begin Google Sign-In (Doc 10 §3.1, Doc 24 §E.2).
 *
 * GET, not POST, and reached by top-level navigation. A form POST would
 * interact with the `form-action 'self'` CSP directive; a plain redirect does
 * not, so no CSP change is needed (Doc 24 §E.2).
 *
 * The post-login destination is sanitised to a same-origin relative path before
 * it is stored, so the flow cannot be turned into an open redirect
 * (Doc 23 §16.4).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withApiHandler(async (request, { requestId }) => {
  await consume(oauthLimiter, ipKey(request, 'oauth-start'))

  if (!isGoogleConfigured()) {
    return apiError(
      'SERVICE_UNAVAILABLE',
      'Google Sign-In is not configured on this deployment. Use email and password instead.',
      { requestId },
    )
  }

  const redirectTarget = sanitiseRedirectTarget(new URL(request.url).searchParams.get('redirect'))
  const { url } = createAuthorizationRequest(redirectTarget)

  return NextResponse.redirect(url, { status: 302 })
})
