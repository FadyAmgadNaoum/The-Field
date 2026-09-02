import { withApiHandler } from '@/lib/api/handler'
import { apiSuccess } from '@/lib/api/response'

/**
 * API root — establishes the `/api/v1` namespace and demonstrates the response
 * envelope every route must use (Doc 11 §2, Doc 22 §5.1).
 *
 * Business endpoints are added by the milestone that owns them:
 *   M3  /api/v1/courts, /api/v1/availability, /api/v1/bookings
 *   M4  /api/v1/bookings/proof, admin approval routes
 *   M1  /api/v1/auth/*, /api/v1/admin/auth/*
 *
 * Returns no configuration, no version of any dependency, and nothing that
 * assists fingerprinting.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withApiHandler(async (_request, { requestId }) => {
  return apiSuccess({ api: 'thefield', version: 'v1' }, { requestId })
})
