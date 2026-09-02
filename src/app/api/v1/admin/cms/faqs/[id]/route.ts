import { withApiHandler } from '@/lib/api/handler'
import { requireAdminFor } from '@/lib/api/admin-guard'
import { parseJsonBody } from '@/lib/api/parse'
import { apiSuccess } from '@/lib/api/response'
import { venueConfig } from '@/lib/config'
import { NotFoundError } from '@/lib/errors'
import * as cms from '@/modules/cms/cms.service'
import { faqInputSchema } from '@/modules/cms/cms.validators'

/**
 * Single FAQ (Doc 22 M2-T03).
 *
 * ── IDOR ─────────────────────────────────────────────────────────────────────
 * `venueConfig.id` is passed to every service call and forms part of the SQL
 * predicate, so a row belonging to another venue simply does not match. The
 * caller receives 404 rather than 403, which is what stops the endpoint being
 * used to discover which ids exist (Doc 13 T-004, Doc 22 §10.3).
 *
 * A malformed id is answered as 404 for the same reason — a distinct 400 would
 * confirm the id space's shape.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requireId(id: string): string {
  if (!UUID.test(id)) throw new NotFoundError()
  return id
}

export const PUT = withApiHandler<{ id: string }>(async (request, { requestId, params }) => {
  const session = await requireAdminFor(request, 'manage_cms')
  const input = await parseJsonBody(request, faqInputSchema)
  const faq = await cms.updateFaq(requireId(params.id), venueConfig.id, input, session.adminId)
  return apiSuccess({ faq }, { requestId })
})

export const DELETE = withApiHandler<{ id: string }>(async (request, { requestId, params }) => {
  const session = await requireAdminFor(request, 'manage_cms')
  await cms.deleteFaq(requireId(params.id), venueConfig.id, session.adminId)
  return apiSuccess({ deleted: true }, { requestId })
})
