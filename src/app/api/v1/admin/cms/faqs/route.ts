import { withApiHandler } from '@/lib/api/handler'
import { requireAdminFor } from '@/lib/api/admin-guard'
import { parseJsonBody } from '@/lib/api/parse'
import { apiSuccess } from '@/lib/api/response'
import { venueConfig } from '@/lib/config'
import * as cms from '@/modules/cms/cms.service'
import { faqInputSchema } from '@/modules/cms/cms.validators'

/**
 * FAQ collection (Doc 22 M2-T03, Doc 09 §6.2).
 *
 * `GET` returns unpublished entries too — an administrator manages drafts here.
 * The PUBLIC FAQ page calls `getFaqs(venueId, true)` and never sees them.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withApiHandler(async (request, { requestId }) => {
  await requireAdminFor(request, 'manage_cms')
  const faqs = await cms.getFaqs(venueConfig.id, false)
  return apiSuccess({ faqs }, { requestId })
})

export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireAdminFor(request, 'manage_cms')
  const input = await parseJsonBody(request, faqInputSchema)
  const faq = await cms.createFaq(venueConfig.id, input, session.adminId)
  return apiSuccess({ faq }, { status: 201, requestId })
})
