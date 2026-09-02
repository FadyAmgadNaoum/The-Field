import { withApiHandler } from '@/lib/api/handler'
import { requireAdminFor } from '@/lib/api/admin-guard'
import { parseJsonBody } from '@/lib/api/parse'
import { apiSuccess } from '@/lib/api/response'
import { venueConfig } from '@/lib/config'
import * as cms from '@/modules/cms/cms.service'
import { reorderSchema } from '@/modules/cms/cms.validators'

/**
 * FAQ reordering (Doc 09 §6.2).
 *
 * The whole ordering is submitted at once and applied in one transaction, so a
 * partial reorder is never visible on the public page. Ids that do not belong
 * to this venue match nothing and are silently skipped rather than reported —
 * the response says nothing about which ids were real.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireAdminFor(request, 'manage_cms')
  const input = await parseJsonBody(request, reorderSchema)
  await cms.reorderFaqs(venueConfig.id, input.orderedIds, session.adminId)
  return apiSuccess({ reordered: input.orderedIds.length }, { requestId })
})
