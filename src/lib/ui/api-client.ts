import { CSRF_HEADER } from '@/lib/auth/csrf-constants'

/**
 * Browser-side API helper for the public site.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Every public form needs the same four things: a fresh CSRF token, the JSON
 * content type the API requires (Doc 24 §E.4), a normalised error, and no
 * possibility of a double submission. Doing that in each form guarantees one of
 * them eventually gets forgotten.
 *
 * ── ERRORS ARE NORMALISED, NOT INTERPRETED ───────────────────────────────────
 * The server decides what a failure means and returns a stable `code`
 * (Doc 11 §3). This helper hands back that code plus the server's message and
 * any field errors — it never invents its own explanation, and it never
 * inspects a status code to guess. A response the browser cannot parse becomes
 * INTERNAL_ERROR rather than leaking the raw body into the UI.
 */

export interface ApiFieldErrors {
  formErrors?: string[]
  fieldErrors?: Record<string, string[] | undefined>
}

export class ApiRequestError extends Error {
  readonly code: string
  readonly status: number
  readonly details: ApiFieldErrors | undefined

  constructor(code: string, message: string, status: number, details?: ApiFieldErrors) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.status = status
    this.details = details
  }

  /** First message for a named field, if the server reported one. */
  fieldError(field: string): string | undefined {
    return this.details?.fieldErrors?.[field]?.[0]
  }
}

async function fetchCsrfToken(): Promise<string> {
  const response = await fetch('/api/v1/csrf', {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new ApiRequestError('INTERNAL_ERROR', 'Could not obtain a CSRF token.', response.status)
  }

  const body = (await response.json()) as { data?: { csrfToken?: string } }
  const token = body.data?.csrfToken

  if (!token) {
    throw new ApiRequestError('INTERNAL_ERROR', 'Could not obtain a CSRF token.', response.status)
  }
  return token
}

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: { code?: string; message?: string; details?: ApiFieldErrors }
}

/**
 * POST JSON to the API, with a freshly minted CSRF token.
 *
 * The token is fetched immediately before the request rather than on mount, so
 * a form left open for hours cannot fail on a stale token.
 */
export async function postJson<TResponse>(path: string, body: unknown): Promise<TResponse> {
  let response: Response

  try {
    const csrfToken = await fetchCsrfToken()

    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [CSRF_HEADER]: csrfToken },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch (error) {
    if (error instanceof ApiRequestError) throw error
    // A transport failure — offline, DNS, TLS. Distinguished from a server
    // error so the UI can tell the customer to check their connection.
    throw new ApiRequestError('NETWORK', 'Network request failed.', 0)
  }

  let envelope: ApiEnvelope<TResponse>
  try {
    envelope = (await response.json()) as ApiEnvelope<TResponse>
  } catch {
    throw new ApiRequestError('INTERNAL_ERROR', 'Unexpected response.', response.status)
  }

  if (!response.ok || !envelope.success) {
    throw new ApiRequestError(
      envelope.error?.code ?? 'INTERNAL_ERROR',
      envelope.error?.message ?? 'Request failed.',
      response.status,
      envelope.error?.details,
    )
  }

  return envelope.data as TResponse
}
