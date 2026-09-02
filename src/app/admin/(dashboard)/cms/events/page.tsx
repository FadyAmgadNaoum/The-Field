import { requireUsableAdminSession } from '@/lib/auth/admin-session'
import { requirePermission } from '@/lib/auth/permissions'
import { venueConfig } from '@/lib/config'
import { CmsEventsEditor } from '@/components/admin/cms-events-editor'
import * as cms from '@/modules/cms/cms.service'

/** Events management (Doc 22 M2-T09, Doc 09 §6.4). */
export const dynamic = 'force-dynamic'

export default async function AdminEventsPage() {
  const session = await requireUsableAdminSession()
  await requirePermission(session, 'manage_cms')

  const events = await cms.getEvents(venueConfig.id, false)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-semibold text-ink-900">Events</h1>
        <p className="mt-1 text-body-sm text-ink-600">Venue events and their publication state.</p>
      </div>
      <CmsEventsEditor initial={events} />
    </div>
  )
}
