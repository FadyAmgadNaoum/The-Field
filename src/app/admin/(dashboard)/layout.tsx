import { redirect } from 'next/navigation'
import { getAdminSession } from '@/lib/auth/admin-session'

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
 */
export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession()

  if (!session) redirect('/admin/login')
  // A temporary credential may not operate the dashboard (Doc 21 RC-007b).
  if (session.mustChangePassword) redirect('/admin/change-password')

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="text-sm font-semibold tracking-tight">The Field — Administration</span>
          <span className="text-xs text-slate-500">
            {session.fullName} · {session.roleName}
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-8">{children}</div>
    </div>
  )
}
