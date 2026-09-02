import { withApiHandler } from '@/lib/api/handler'
import { requireAdminFor } from '@/lib/api/admin-guard'
import { parseJsonBody } from '@/lib/api/parse'
import { apiSuccess } from '@/lib/api/response'
import { venueConfig } from '@/lib/config'
import * as cms from '@/modules/cms/cms.service'
import { announcementInputSchema } from '@/modules/cms/cms.validators'

/**
 * Announcements collection (Doc 22 M2-T03, Doc 09 §6.5).
 *
 * `GET` returns every announcement including expired and unpublished ones, so
 * the editor can show the active/expired tabs. The public homepage banner calls
 * `getActiveAnnouncements`, which filters on `is_published` AND the expiry.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withApiHandler(async (request, { requestId }) => {
  await requireAdminFor(request, 'manage_cms')
  const announcements = await cms.getAllAnnouncements(venueConfig.id)
  return apiSuccess({ announcements }, { requestId })
})

export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireAdminFor(request, 'manage_cms')
  const input = await parseJsonBody(request, announcementInputSchema)
  const announcement = await cms.createAnnouncement(venueConfig.id, input, session.adminId)
  return apiSuccess({ announcement }, { status: 201, requestId })
})
