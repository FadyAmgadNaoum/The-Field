import { requireUsableAdminSession } from '@/lib/auth/admin-session'
import { getPermissions } from '@/lib/auth/permissions'

/**
 * Administrator dashboard skeleton (Doc 22 M1-T09).
 *
 * Deliberately contains NO operational data. Booking counts, the review queue
 * and payment verification widgets belong to Milestones 3–5; the tables they
 * would read are empty by design at this point (Doc 22 §4.5).
 *
 * What it does prove is that the authentication and authorisation chain works
 * end to end: the session resolved, the role loaded, and the permission set
 * came from the database rather than from anything the browser sent.
 */
export const dynamic = 'force-dynamic'

export default async function AdminDashboardPage() {
  const session = await requireUsableAdminSession()
  const permissions = await getPermissions(session)

  return (
    <main className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Signed in as {session.email} with the <strong>{session.roleName}</strong> role.
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium text-slate-900">Your permissions</h2>
        <p className="mt-1 text-xs text-slate-500">
          Loaded from the database for your role. Every action is re-checked server-side.
        </p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {permissions.map((permission) => (
            <li
              key={permission}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700"
            >
              {permission}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-dashed border-slate-300 p-5">
        <h2 className="text-sm font-medium text-slate-900">Operations</h2>
        <p className="mt-1 text-sm text-slate-600">
          Booking management, payment verification, court, pricing and schedule administration are
          delivered in later milestones.
        </p>
      </section>
    </main>
  )
}
