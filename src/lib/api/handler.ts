import { type NextResponse } from 'next/server'
import { toAppError, ValidationError } from '../errors'
import { captureException } from '../observability'
import { requestLogger } from '../logger'
import { getClientIp, getRequestId } from './request-context'
import { apiError } from './response'

/**
 * Centralised API route wrapper (Doc 22 §5.2, Doc 24 §K).
 *
 * Guarantees for every route that uses it:
 *  - a request id on the response, correlated with every log line
 *  - errors normalised through the documented catalogue
 *  - 5xx detail captured server-side and never serialised to the client
 *    (Doc 02 FR-SEC-013, Doc 03 NFR-AVAIL-006)
 *
 * The documented handler order is: rate limit → parse → validate → authenticate
 * → authorise → service → respond (Doc 22 §5.2). Rate limiting, authentication
 * and authorisation arrive in Milestone 1; this wrapper provides the error and
 * correlation layer they plug into.
 */

export interface ApiHandlerContext {
  requestId: string
  clientIp: string | null
}

export type ApiRouteHandler<TParams = unknown> = (
  request: Request,
  context: ApiHandlerContext & { params: TParams },
) => Promise<NextResponse> | NextResponse

export function withApiHandler<TParams = unknown>(handler: ApiRouteHandler<TParams>) {
  return async (request: Request, routeContext?: { params: TParams }): Promise<NextResponse> => {
    const requestId = getRequestId(request)
    const clientIp = getClientIp(request)
    const url = new URL(request.url)
    const log = requestLogger({ requestId, method: request.method, path: url.pathname })

    try {
      return await handler(request, {
        requestId,
        clientIp,
        params: (routeContext?.params ?? ({} as TParams)) as TParams,
      })
    } catch (error) {
      const appError = toAppError(error)

      if (appError.status >= 500) {
        captureException(error, { requestId, method: request.method, path: url.pathname })
      } else {
        log.warn(
          { code: appError.code, status: appError.status },
          'Request rejected: %s',
          appError.message,
        )
      }

      return apiError(appError.code, appError.message, {
        details: appError.details,
        requestId,
      })
    }
  }
}

/**
 * CSRF secondary defence (Doc 10 §5.4, Doc 24 §E.4).
 *
 * `SameSite=Lax` is the primary control. Requiring a JSON content type is the
 * documented secondary: a cross-origin HTML form cannot set this header, only
 * `fetch`/XHR can. `X-Requested-With` is deliberately NOT used (Doc 24 §E.4).
 *
 * Multipart endpoints (booking creation, proof upload) are excluded by design —
 * they rely on SameSite plus an explicit CSRF token on the form (Doc 10 §5.4).
 */
export function assertJsonContentType(request: Request): void {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ValidationError('Requests to this endpoint must use Content-Type: application/json.')
  }
}
