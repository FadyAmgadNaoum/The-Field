import { requireUsableAdminSession } from '@/lib/auth/admin-session'
import { requirePermission } from '@/lib/auth/permissions'
import { venueConfig } from '@/lib/config'
import { CmsGalleryEditor } from '@/components/admin/cms-gallery-editor'
import * as cms from '@/modules/cms/cms.service'

/** Gallery management (Doc 22 M2-T09, Doc 09 §6.3). */
export const dynamic = 'force-dynamic'

export default async function AdminGalleryPage() {
  const session = await requireUsableAdminSession()
  await requirePermission(session, 'manage_cms')

  const items = await cms.getGalleryItems(venueConfig.id, false)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-semibold text-ink-900">Gallery</h1>
        <p className="mt-1 text-body-sm text-ink-600">
          Images uploaded here appear on the public gallery page and in the home page strip.
        </p>
      </div>
      <CmsGalleryEditor initial={items} />
    </div>
  )
}
