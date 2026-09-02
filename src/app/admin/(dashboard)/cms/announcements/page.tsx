import { requireUsableAdminSession } from '@/lib/auth/admin-session'
import { requirePermission } from '@/lib/auth/permissions'
import { venueConfig } from '@/lib/config'
import { CmsAnnouncementsEditor } from '@/components/admin/cms-announcements-editor'
import * as cms from '@/modules/cms/cms.service'

/** Announcements management (Doc 22 M2-T09, Doc 09 §6.5). */
export const dynamic = 'force-dynamic'

export default async function AdminAnnouncementsPage() {
  const session = await requireUsableAdminSession()
  await requirePermission(session, 'manage_cms')

  const announcements = await cms.getAllAnnouncements(venueConfig.id)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-semibold text-ink-900">Announcements</h1>
        <p className="mt-1 text-body-sm text-ink-600">
          Published, unexpired announcements appear as a banner at the top of the home page.
        </p>
      </div>
      <CmsAnnouncementsEditor initial={announcements} />
    </div>
  )
}
