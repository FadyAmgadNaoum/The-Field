import { withApiHandler } from '@/lib/api/handler'
import { requireAdminFor } from '@/lib/api/admin-guard'
import { parseJsonBody } from '@/lib/api/parse'
import { apiSuccess } from '@/lib/api/response'
import { venueConfig } from '@/lib/config'
import * as cms from '@/modules/cms/cms.service'
import { eventInputSchema } from '@/modules/cms/cms.validators'

/** Events collection (Doc 22 M2-T03, Doc 09 §6.4). */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withApiHandler(async (request, { requestId }) => {
  await requireAdminFor(request, 'manage_cms')
  const events = await cms.getEvents(venueConfig.id, false)
  return apiSuccess({ events }, { requestId })
})

export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireAdminFor(request, 'manage_cms')
  const input = await parseJsonBody(request, eventInputSchema)
  const event = await cms.createEvent(venueConfig.id, input, session.adminId)
  return apiSuccess({ event }, { status: 201, requestId })
})
