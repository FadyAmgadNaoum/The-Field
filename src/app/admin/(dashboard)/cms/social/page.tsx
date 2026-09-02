import { requireUsableAdminSession } from '@/lib/auth/admin-session'
import { requirePermission } from '@/lib/auth/permissions'
import { venueConfig } from '@/lib/config'
import { CmsSocialEditor } from '@/components/admin/cms-social-editor'
import * as cms from '@/modules/cms/cms.service'

/** Social link management (Doc 22 M2-T09, Doc 09 §6.6). */
export const dynamic = 'force-dynamic'

export default async function AdminSocialPage() {
  const session = await requireUsableAdminSession()
  await requirePermission(session, 'manage_cms')

  const links = await cms.getSocialLinks(venueConfig.id, false)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-semibold text-ink-900">Social links</h1>
        <p className="mt-1 text-body-sm text-ink-600">
          Active links appear in the website footer. Nothing is shown for a platform with no URL.
        </p>
      </div>
      <CmsSocialEditor initial={links} />
    </div>
  )
}
