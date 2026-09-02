import { withApiHandler } from '@/lib/api/handler'
import { requireAdminFor } from '@/lib/api/admin-guard'
import { parseJsonBody } from '@/lib/api/parse'
import { apiSuccess } from '@/lib/api/response'
import { venueConfig } from '@/lib/config'
import * as cms from '@/modules/cms/cms.service'
import { socialLinkInputSchema } from '@/modules/cms/cms.validators'

/**
 * Social links (Doc 22 M2-T03, Doc 09 §6.6).
 *
 * One row per platform, enforced by `uq_social_platform`, so the write is an
 * upsert keyed on the platform rather than a create/update pair. The platform
 * comes from a fixed enum — a link to an arbitrary named service cannot be
 * added, which keeps the footer's rendering total.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withApiHandler(async (request, { requestId }) => {
  await requireAdminFor(request, 'manage_cms')
  const links = await cms.getSocialLinks(venueConfig.id, false)
  return apiSuccess({ links }, { requestId })
})

export const PUT = withApiHandler(async (request, { requestId }) => {
  const session = await requireAdminFor(request, 'manage_cms')
  const input = await parseJsonBody(request, socialLinkInputSchema)

  await cms.upsertSocialLink(
    venueConfig.id,
    input.platform,
    input.url,
    input.isActive,
    session.adminId,
  )

  const links = await cms.getSocialLinks(venueConfig.id, false)
  return apiSuccess({ links }, { requestId })
})
