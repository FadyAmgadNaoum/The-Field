import { NextResponse } from 'next/server'
import { type ApiErrorCode, httpStatusForCode } from './error-codes'

/**
 * Standard response envelope (Doc 11 §2, Doc 22 §5.1).
 *
 * Every API route returns one of these shapes. No route hand-builds a response
 * body, so the contract cannot drift between endpoints.
 */

export interface ApiSuccessBody<T> {
  success: true
  data: T
}

export interface ApiErrorBody {
  success: false
  error: {
    code: ApiErrorCode
    message: string
    details?: unknown
  }
}

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PaginatedData<T> {
  items: T[]
  pagination: PaginationMeta
}

export const REQUEST_ID_HEADER = 'x-request-id'

function withHeaders(response: NextResponse, requestId?: string): NextResponse {
  if (requestId) response.headers.set(REQUEST_ID_HEADER, requestId)
  // API responses are never cached by Cloudflare or the browser
  // (Doc 23 §13.1 cache bypass rules; availability must always be fresh —
  // Doc 22 §5.3).
  response.headers.set('Cache-Control', 'no-store, must-revalidate')
  return response
}

export function apiSuccess<T>(
  data: T,
  init: { status?: number; requestId?: string } = {},
): NextResponse<ApiSuccessBody<T>> {
  const body: ApiSuccessBody<T> = { success: true, data }
  return withHeaders(
    NextResponse.json(body, { status: init.status ?? 200 }),
    init.requestId,
  ) as NextResponse<ApiSuccessBody<T>>
}

export function apiPaginated<T>(
  items: T[],
  pagination: PaginationMeta,
  init: { requestId?: string } = {},
): NextResponse<ApiSuccessBody<PaginatedData<T>>> {
  return apiSuccess({ items, pagination }, init)
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  init: { details?: unknown; requestId?: string; status?: number } = {},
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = {
    success: false,
    error: {
      code,
      message,
      ...(init.details !== undefined ? { details: init.details } : {}),
    },
  }
  return withHeaders(
    NextResponse.json(body, { status: init.status ?? httpStatusForCode(code) }),
    init.requestId,
  ) as NextResponse<ApiErrorBody>
}

/** Build the pagination block from a total row count. */
export function buildPagination(page: number, pageSize: number, total: number): PaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  }
}
