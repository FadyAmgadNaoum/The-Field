import { withApiHandler } from '@/lib/api/handler'
import { requireAdminFor } from '@/lib/api/admin-guard'
import { parseJsonBody } from '@/lib/api/parse'
import { apiSuccess } from '@/lib/api/response'
import { venueConfig } from '@/lib/config'
import { NotFoundError } from '@/lib/errors'
import * as cms from '@/modules/cms/cms.service'
import { eventInputSchema } from '@/modules/cms/cms.validators'

/** Single event (Doc 09 §6.4). Venue-scoped; unknown ids answer 404. */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const PUT = withApiHandler<{ id: string }>(async (request, { requestId, params }) => {
  const session = await requireAdminFor(request, 'manage_cms')
  if (!UUID.test(params.id)) throw new NotFoundError()

  const input = await parseJsonBody(request, eventInputSchema)
  await cms.updateEvent(params.id, venueConfig.id, input, session.adminId)
  return apiSuccess({ updated: true }, { requestId })
})

export const DELETE = withApiHandler<{ id: string }>(async (request, { requestId, params }) => {
  const session = await requireAdminFor(request, 'manage_cms')
  if (!UUID.test(params.id)) throw new NotFoundError()

  await cms.deleteEvent(params.id, venueConfig.id, session.adminId)
  return apiSuccess({ deleted: true }, { requestId })
})
