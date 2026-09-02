import { Google, decodeIdToken, generateCodeVerifier, generateState } from 'arctic'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { googleConfig, isProduction } from '../config'
import { ForbiddenError, ServiceUnavailableError, ValidationError } from '../errors'

/**
 * Google Sign-In (Doc 10 §3.1, Doc 22 §6.3, Doc 24 §E.2).
 *
 * `arctic` is an OAuth client and nothing more: it issues no cookies, owns no
 * session and imposes no schema, which is exactly what the architecture needs.
 * NextAuth and Lucia are explicitly excluded (Doc 22 §2, Doc 24 §E.2).
 *
 * Security properties enforced here:
 *   - the redirect URI is a single fixed configured value, never derived from a
 *     request, so the callback cannot be pointed at another origin
 *   - `state` is required and compared against a short-lived cookie (CSRF on
 *     the OAuth flow itself)
 *   - PKCE `code_verifier` never leaves the server
 *   - the post-login redirect target must be a same-origin relative path, so
 *     the flow cannot be used as an open redirect (Doc 23 §16.4)
 */

export const OAUTH_STATE_COOKIE = 'thefield_oauth_state'
export const OAUTH_VERIFIER_COOKIE = 'thefield_oauth_verifier'
export const OAUTH_REDIRECT_COOKIE = 'thefield_oauth_redirect'

/** Ten minutes is ample for a consent screen and bounds replay. */
const OAUTH_COOKIE_MAX_AGE = 60 * 10

const SCOPES = ['openid', 'profile', 'email']

function client(): Google {
  if (!googleConfig.isConfigured) {
    throw new ServiceUnavailableError(
      'Google Sign-In is not configured on this deployment. Use email and password instead.',
    )
  }
  return new Google(googleConfig.clientId!, googleConfig.clientSecret!, googleConfig.redirectUri!)
}

export function isGoogleConfigured(): boolean {
  return googleConfig.isConfigured
}

/**
 * Reduce a caller-supplied redirect to a safe same-origin path.
 *
 * Rejects absolute URLs, protocol-relative URLs (`//evil.com`) and anything
 * that is not a single leading slash. Returns the fallback rather than throwing
 * so a malformed value degrades to the default destination.
 */
export function sanitiseRedirectTarget(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback
  // Must be exactly one leading slash: `//host` and `/\host` are origin changes.
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  if (value.includes('://') || value.includes('\\')) return fallback
  // Control characters, space and DEL can smuggle a header (CR/LF) or make one
  // parser disagree with another about where the path ends.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f]/.test(value)) return fallback
  return value
}

function oauthCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: OAUTH_COOKIE_MAX_AGE,
  }
}

export interface AuthorizationRequest {
  url: string
}

/** Begin the flow: mint state + PKCE verifier, stash them, return the URL. */
export function createAuthorizationRequest(redirectTarget: string): AuthorizationRequest {
  const google = client()
  const state = generateState()
  const codeVerifier = generateCodeVerifier()

  const store = cookies()
  store.set(OAUTH_STATE_COOKIE, state, oauthCookieOptions())
  store.set(OAUTH_VERIFIER_COOKIE, codeVerifier, oauthCookieOptions())
  store.set(OAUTH_REDIRECT_COOKIE, sanitiseRedirectTarget(redirectTarget), oauthCookieOptions())

  return { url: google.createAuthorizationURL(state, codeVerifier, SCOPES).toString() }
}

export function clearOAuthCookies(): void {
  const store = cookies()
  for (const name of [OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, OAUTH_REDIRECT_COOKIE]) {
    store.delete(name)
  }
}

/** Claims we rely on from the verified ID token. */
const idTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
})

export interface GoogleIdentity {
  googleId: string
  email: string
  fullName: string
  emailVerified: boolean
}

export interface CallbackResult {
  identity: GoogleIdentity
  redirectTarget: string
}

/**
 * Complete the flow.
 *
 * Throws ForbiddenError when `state` is absent or does not match the cookie —
 * that is the OAuth CSRF check, and it must fail closed.
 */
export async function completeAuthorization(
  code: string | null,
  state: string | null,
): Promise<CallbackResult> {
  const google = client()
  const store = cookies()

  const storedState = store.get(OAUTH_STATE_COOKIE)?.value
  const codeVerifier = store.get(OAUTH_VERIFIER_COOKIE)?.value
  const redirectTarget = sanitiseRedirectTarget(store.get(OAUTH_REDIRECT_COOKIE)?.value)

  if (!state || !storedState || state !== storedState) {
    throw new ForbiddenError('Invalid sign-in request. Please start again.')
  }
  if (!code || !codeVerifier) {
    throw new ValidationError('Incomplete sign-in response. Please start again.')
  }

  // The ID token arrives over TLS directly from Google's token endpoint in a
  // server-to-server exchange, which is why the signature need not be
  // re-verified here (Google's own guidance, Doc 24 §E.2).
  const tokens = await google.validateAuthorizationCode(code, codeVerifier)
  const parsed = idTokenClaimsSchema.safeParse(decodeIdToken(tokens.idToken()))

  if (!parsed.success) {
    throw new ValidationError('Google did not return the required profile information.')
  }

  return {
    identity: {
      googleId: parsed.data.sub,
      email: parsed.data.email.toLowerCase(),
      fullName: parsed.data.name?.trim() || parsed.data.email.split('@')[0] || 'Customer',
      emailVerified: parsed.data.email_verified ?? false,
    },
    redirectTarget,
  }
}
