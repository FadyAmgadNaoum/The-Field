import { withApiHandler } from '@/lib/api/handler'
import { apiSuccess } from '@/lib/api/response'
import { getOrCreateCsrfToken } from '@/lib/auth/csrf'

/**
 * Issue a CSRF token (Doc 10 §5.4, Doc 24 §E.4).
 *
 * Sets the signed token cookie if absent and returns the value to echo back in
 * the `x-csrf-token` header on state-changing requests. Server-rendered forms
 * embed the token directly instead of calling this.
 *
 * Safe to expose: the token authorises nothing on its own. It only proves the
 * caller could read a response from this origin, which is precisely the
 * property a cross-site attacker lacks.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withApiHandler(async (_request, { requestId }) =>
  apiSuccess({ csrfToken: getOrCreateCsrfToken() }, { requestId }),
)
