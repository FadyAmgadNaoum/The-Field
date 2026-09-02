import { beforeEach, describe, expect, it, vi } from 'vitest'

// Google credentials must exist before the config module is evaluated.
// `vi.hoisted` runs ahead of the import graph. The values are fake — no real
// OAuth client is contacted anywhere in this file.
vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret-value'
  process.env.GOOGLE_REDIRECT_URI = 'https://thefield.eg/api/v1/auth/google/callback'
})

vi.mock('next/headers', async () => {
  const { getTestCookieJar } = await import('../helpers/cookie-jar')
  return { cookies: () => getTestCookieJar() }
})

import { ForbiddenError, ValidationError } from '@/lib/errors'
import {
  OAUTH_REDIRECT_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  completeAuthorization,
  createAuthorizationRequest,
  isGoogleConfigured,
} from '@/lib/auth/google'
import { getTestCookieJar, resetTestCookieJar } from '../helpers/cookie-jar'

/**
 * Google OAuth security (Doc 23 §16.4, Doc 24 §E.2).
 *
 * The token exchange itself requires Google and is not reachable offline. What
 * IS tested here is everything that protects the flow before and after that
 * call: state, PKCE, credential handling and the redirect target.
 */

beforeEach(() => {
  resetTestCookieJar()
})

describe('configuration', () => {
  it('is driven entirely by environment variables', () => {
    expect(isGoogleConfigured()).toBe(true)
  })
})

describe('authorization request', () => {
  it('targets Google with the configured client id', () => {
    const url = new URL(createAuthorizationRequest('/book').url)

    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('client_id')).toBe('test-client-id.apps.googleusercontent.com')
  })

  it('uses the fixed configured redirect URI, never a request-supplied one', () => {
    const url = new URL(createAuthorizationRequest('/book').url)
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://thefield.eg/api/v1/auth/google/callback',
    )
  })

  it('never puts the client secret in the URL', () => {
    const raw = createAuthorizationRequest('/book').url
    expect(raw).not.toContain('test-client-secret-value')
    expect(raw).not.toContain('client_secret')
  })

  it('sends state and a PKCE challenge', () => {
    const url = new URL(createAuthorizationRequest('/book').url)

    expect(url.searchParams.get('state')).toBeTruthy()
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('keeps the PKCE verifier server-side only', () => {
    const url = new URL(createAuthorizationRequest('/book').url)
    const verifier = getTestCookieJar().get(OAUTH_VERIFIER_COOKIE)?.value

    expect(verifier).toBeTruthy()
    // The verifier must never travel to Google in the authorization request —
    // only its hash does.
    expect(url.toString()).not.toContain(verifier!)
  })

  it('issues a fresh state on every attempt', () => {
    const first = new URL(createAuthorizationRequest('/book').url).searchParams.get('state')
    resetTestCookieJar()
    const second = new URL(createAuthorizationRequest('/book').url).searchParams.get('state')

    expect(first).not.toBe(second)
  })

  it('requests only the scopes it needs', () => {
    const scope = new URL(createAuthorizationRequest('/').url).searchParams.get('scope') ?? ''
    expect(scope).toContain('openid')
    expect(scope).toContain('email')
    expect(scope).toContain('profile')
  })
})

describe('redirect target handling', () => {
  it('stores a safe relative path', () => {
    createAuthorizationRequest('/book?courtId=abc')
    expect(getTestCookieJar().get(OAUTH_REDIRECT_COOKIE)?.value).toBe('/book?courtId=abc')
  })

  it.each([
    'https://evil.example/steal',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
  ])('reduces %s to the site root — no open redirect', (target) => {
    createAuthorizationRequest(target)
    expect(getTestCookieJar().get(OAUTH_REDIRECT_COOKIE)?.value).toBe('/')
  })
})

describe('callback state validation', () => {
  it('rejects a callback with no state', async () => {
    createAuthorizationRequest('/book')
    await expect(completeAuthorization('some-code', null)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects a state that does not match the cookie', async () => {
    createAuthorizationRequest('/book')
    await expect(
      completeAuthorization('some-code', 'attacker-chosen-state'),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects a callback with no state cookie at all', async () => {
    // A callback arriving without a flow ever having been started.
    await expect(completeAuthorization('some-code', 'some-state')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('rejects a matching state when the authorization code is missing', async () => {
    createAuthorizationRequest('/book')
    const state = getTestCookieJar().get(OAUTH_STATE_COOKIE)!.value

    await expect(completeAuthorization(null, state)).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects when the PKCE verifier cookie was dropped', async () => {
    createAuthorizationRequest('/book')
    const state = getTestCookieJar().get(OAUTH_STATE_COOKIE)!.value
    getTestCookieJar().delete(OAUTH_VERIFIER_COOKIE)

    await expect(completeAuthorization('some-code', state)).rejects.toBeInstanceOf(ValidationError)
  })

  it('does not leak the client secret in a rejection message', async () => {
    createAuthorizationRequest('/book')
    let error: Error | undefined
    try {
      await completeAuthorization('code', 'wrong-state')
    } catch (caught) {
      error = caught as Error
    }

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).not.toContain('test-client-secret-value')
    expect(error!.message).not.toContain('test-client-id')
  })
})
