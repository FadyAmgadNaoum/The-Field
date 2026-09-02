import { fetchCsrfToken, mutationHeaders } from './csrf-client'
import { CSRF_HEADER } from '@/lib/auth/csrf-constants'

/**
 * Browser-side API helper for the administrator dashboard.
 *
 * Separate from `src/lib/ui/api-client.ts` on purpose: that one is loaded into
 * the PUBLIC bundle and its error messages come from the customer message
 * catalogue. The admin dashboard is English-only (Doc 23 REL-M2-T01) and its
 * errors are the server's own wording, which is what an operator needs when
 * something is rejected.
 *
 * Every mutation carries a freshly minted CSRF token, fetched immediately
 * before the request so a form left open all afternoon does not fail on a stale
 * one (Doc 24 §E.4).
 */

export class AdminApiError extends Error {
  readonly code: string
  readonly fieldErrors: Record<string, string[] | undefined>

  constructor(code: string, message: string, fieldErrors: Record<string, string[] | undefined>) {
    super(message)
    this.name = 'AdminApiError'
    this.code = code
    this.fieldErrors = fieldErrors
  }

  fieldError(field: string): string | undefined {
    return this.fieldErrors[field]?.[0]
  }
}

interface Envelope<T> {
  success: boolean
  data?: T
  error?: {
    code?: string
    message?: string
    details?: { fieldErrors?: Record<string, string[] | undefined> }
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  let envelope: Envelope<T>

  try {
    envelope = (await response.json()) as Envelope<T>
  } catch {
    throw new AdminApiError('INTERNAL_ERROR', 'Unexpected response from the server.', {})
  }

  if (!response.ok || !envelope.success) {
    throw new AdminApiError(
      envelope.error?.code ?? 'INTERNAL_ERROR',
      envelope.error?.message ?? 'The request failed.',
      envelope.error?.details?.fieldErrors ?? {},
    )
  }

  return envelope.data as T
}

export async function adminGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  return unwrap<T>(response)
}

export async function adminSend<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const csrfToken = await fetchCsrfToken()

  const response = await fetch(path, {
    method,
    headers: mutationHeaders(csrfToken),
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })

  return unwrap<T>(response)
}

/**
 * Multipart upload.
 *
 * The browser sets `Content-Type` itself so the multipart boundary is correct —
 * setting it by hand produces a body the server cannot parse. The CSRF token
 * travels in its own header, which is the control for this route since the
 * JSON content-type check cannot apply (Doc 24 §E.4).
 */
export async function adminUpload<T>(path: string, form: FormData): Promise<T> {
  const csrfToken = await fetchCsrfToken()

  const response = await fetch(path, {
    method: 'POST',
    headers: { [CSRF_HEADER]: csrfToken },
    body: form,
    cache: 'no-store',
  })

  return unwrap<T>(response)
}
