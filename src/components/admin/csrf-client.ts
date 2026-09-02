import { CSRF_HEADER } from '@/lib/auth/csrf-constants'

/**
 * Obtain a CSRF token from the browser.
 *
 * Next.js only permits setting cookies from a Route Handler or Server Action —
 * never during a page render — so the token cannot be minted while rendering a
 * form. The form asks `/api/v1/csrf` for one instead, which sets the cookie and
 * returns the matching value.
 *
 * The token is fetched immediately before submitting rather than on mount, so a
 * form left open for hours cannot go stale.
 */
export async function fetchCsrfToken(): Promise<string> {
  const response = await fetch('/api/v1/csrf', {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })

  if (!response.ok) throw new Error('Could not obtain a CSRF token')

  const body = (await response.json()) as { data?: { csrfToken?: string } }
  const token = body.data?.csrfToken
  if (!token) throw new Error('Could not obtain a CSRF token')

  return token
}

/** Headers for a state-changing JSON request. */
export function mutationHeaders(csrfToken: string): HeadersInit {
  return { 'Content-Type': 'application/json', [CSRF_HEADER]: csrfToken }
}
