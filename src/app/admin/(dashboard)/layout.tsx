import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAdminSession } from '@/lib/auth/admin-session'
import { getPermissions } from '@/lib/auth/permissions'

/**
 * Guard for every administrator dashboard route (Doc 22 M1-T08, §11.2).
 *
 * This is a server component, so the check runs before any markup is produced
 * and cannot be bypassed from the client.
 *
 * The route-group parentheses keep `/admin/login` and `/admin/change-password`
 * outside this guard — both must stay reachable to an administrator who cannot
 * yet use the dashboard.
 *
 * The middleware performs a cheap cookie-presence redirect for the same paths,
 * but that is a UX fast path only. THIS is the authority for pages, and each
 * API route re-checks independently (Doc 22 §7.2).
 *
 * ── ABOUT THE NAVIGATION ─────────────────────────────────────────────────────
 * Links are hidden when the administrator lacks the permission they lead to.
 * That is COSMETIC ONLY (Doc 22 §7.2, Doc 10 §4.3): typing the URL still
 * reaches the page, and the page and every API route behind it re-check the
 * permission server-side. Hiding a link is a courtesy, never a control.
 */
export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession()

  if (!session) redirect('/admin/login')
  // A temporary credential may not operate the dashboard (Doc 21 RC-007b).
  if (session.mustChangePassword) redirect('/admin/change-password')

  const permissions = await getPermissions(session)
  const canManageCms = permissions.includes('manage_cms')

  const links = [
    { href: '/admin/dashboard', label: 'Dashboard', visible: true },
    { href: '/admin/cms/settings', label: 'Site settings', visible: canManageCms },
    { href: '/admin/cms/faqs', label: 'FAQs', visible: canManageCms },
    { href: '/admin/cms/gallery', label: 'Gallery', visible: canManageCms },
    { href: '/admin/cms/events', label: 'Events', visible: canManageCms },
    { href: '/admin/cms/announcements', label: 'Announcements', visible: canManageCms },
    { href: '/admin/cms/social', label: 'Social links', visible: canManageCms },
  ].filter((link) => link.visible)

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <span className="text-body-sm font-semibold tracking-tight">
            The Field — Administration
          </span>
          <span className="text-body-sm text-ink-500">
            {session.fullName} · {session.roleName}
          </span>
        </div>

        <nav aria-label="Administration" className="border-t border-line">
          <ul className="mx-auto flex max-w-5xl flex-wrap gap-1 px-6 py-2">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex min-h-touch items-center rounded-control px-3 text-body-sm font-medium text-ink-700 hover:bg-ink-100 hover:text-ink-900"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  )
}
