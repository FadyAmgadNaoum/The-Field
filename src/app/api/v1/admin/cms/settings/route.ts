import { withApiHandler } from '@/lib/api/handler'
import { requireAdminFor } from '@/lib/api/admin-guard'
import { parseJsonBody } from '@/lib/api/parse'
import { apiSuccess } from '@/lib/api/response'
import { venueConfig } from '@/lib/config'
import { ValidationError } from '@/lib/errors'
import * as cms from '@/modules/cms/cms.service'
import { isCmsGroup, cmsSettingsInGroup } from '@/modules/cms/cms.keys'
import { updateSettingsSchema } from '@/modules/cms/cms.validators'

/**
 * CMS settings read and write (Doc 22 M2-T03, §10.3; Doc 09 §6.1).
 *
 * Both verbs require `manage_cms`. The venue is `venueConfig.id` — never a
 * request field, so there is no venue parameter to tamper with (Doc 24 §M
 * item 16). The service writes one `cms_updated` audit row per changed key and
 * invalidates the public cache tag (Doc 09 §8).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withApiHandler(async (request, { requestId }) => {
  await requireAdminFor(request, 'manage_cms')

  const group = new URL(request.url).searchParams.get('group')
  if (!isCmsGroup(group)) {
    throw new ValidationError('Unknown settings group.')
  }

  const values = await cms.getSettingGroup(venueConfig.id, group)

  return apiSuccess(
    {
      group,
      // The catalogue travels with the values so the editor renders every
      // field — including ones never yet saved — without duplicating the
      // definition list in the client bundle.
      definitions: cmsSettingsInGroup(group),
      values,
    },
    { requestId },
  )
})

export const PUT = withApiHandler(async (request, { requestId }) => {
  const session = await requireAdminFor(request, 'manage_cms')

  const input = await parseJsonBody(request, updateSettingsSchema)

  await cms.updateSettingGroup(venueConfig.id, input.group, input.settings, session.adminId)

  const values = await cms.getSettingGroup(venueConfig.id, input.group)

  return apiSuccess({ group: input.group, values }, { requestId })
})
