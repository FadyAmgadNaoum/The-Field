import { requireUsableAdminSession } from '@/lib/auth/admin-session'
import { requirePermission } from '@/lib/auth/permissions'
import { venueConfig } from '@/lib/config'
import { CmsFaqsEditor } from '@/components/admin/cms-faqs-editor'
import * as cms from '@/modules/cms/cms.service'

/**
 * FAQ management (Doc 22 M2-T09, Doc 09 §6.2).
 *
 * The permission is asserted here as well as in every API route behind the
 * editor — hiding the navigation link is cosmetic only (Doc 22 §7.2).
 */
export const dynamic = 'force-dynamic'

export default async function AdminFaqsPage() {
  const session = await requireUsableAdminSession()
  await requirePermission(session, 'manage_cms')

  // `false` — the editor manages drafts too. The public page requests published
  // entries only.
  const faqs = await cms.getFaqs(venueConfig.id, false)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-semibold text-ink-900">FAQs</h1>
        <p className="mt-1 text-body-sm text-ink-600">
          Published questions appear on the public FAQ page in the order below.
        </p>
      </div>
      <CmsFaqsEditor initial={faqs} />
    </div>
  )
}
