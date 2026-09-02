import Link from 'next/link'
import { requireUsableAdminSession } from '@/lib/auth/admin-session'
import { requirePermission } from '@/lib/auth/permissions'
import { venueConfig } from '@/lib/config'
import { CmsSettingsEditor } from '@/components/admin/cms-settings-editor'
import { CMS_GROUPS, cmsSettingsInGroup, isCmsGroup, type CmsGroup } from '@/modules/cms/cms.keys'
import * as cms from '@/modules/cms/cms.service'

/**
 * CMS settings editor (Doc 22 M2-T08, Doc 09 §6.1).
 *
 * Tab groups are URL segments (`?group=payment`) rather than client state, so a
 * tab is linkable, survives a refresh, and is reachable without JavaScript. The
 * page itself is a server component; only the form is a client island.
 *
 * The permission is checked HERE as well as in the API route behind it. Hiding
 * the navigation link is cosmetic; this is one of the two real gates
 * (Doc 22 §7.2, Doc 24 §M item 15).
 */

export const dynamic = 'force-dynamic'

const GROUP_LABELS: Record<CmsGroup, string> = {
  general: 'General',
  contact: 'Contact',
  payment: 'Payment',
  homepage: 'Homepage',
  about: 'About',
  seo: 'SEO',
}

export default async function CmsSettingsPage({
  searchParams,
}: {
  searchParams: { group?: string }
}) {
  const session = await requireUsableAdminSession()
  await requirePermission(session, 'manage_cms')

  const group: CmsGroup = isCmsGroup(searchParams.group) ? searchParams.group : 'general'
  const values = await cms.getSettingGroup(venueConfig.id, group)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-semibold text-ink-900">Site settings</h1>
        <p className="mt-1 text-body-sm text-ink-600">
          Every value here is published on the customer-facing website. Fields left empty are hidden
          on the public site rather than shown as placeholders.
        </p>
      </div>

      <nav aria-label="Settings groups">
        <ul className="flex flex-wrap gap-1 border-b border-line pb-2">
          {CMS_GROUPS.map((name) => (
            <li key={name}>
              <Link
                href={`/admin/cms/settings?group=${name}`}
                aria-current={name === group ? 'page' : undefined}
                className={`inline-flex min-h-touch items-center rounded-control px-3 text-body-sm font-medium ${
                  name === group
                    ? 'bg-ink-900 text-white'
                    : 'text-ink-700 hover:bg-ink-100 hover:text-ink-900'
                }`}
              >
                {GROUP_LABELS[name]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="rounded-card border border-line bg-white p-6">
        <CmsSettingsEditor
          // `key` forces a fresh form when the tab changes, so the previous
          // group's unsaved values cannot leak into the next one.
          key={group}
          initial={{ group, definitions: [...cmsSettingsInGroup(group)], values }}
        />
      </div>
    </div>
  )
}
