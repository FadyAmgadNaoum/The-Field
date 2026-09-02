import { redirect } from 'next/navigation'
import { getAdminSession } from '@/lib/auth/admin-session'
import { AdminChangePasswordForm } from '@/components/admin/admin-change-password-form'

/**
 * Administrator password change (Doc 22 M1-T12).
 *
 * Guarded by a session, but NOT by `requireUsableAdminSession` — this is the
 * one route that must stay reachable while `must_change_password` is set,
 * otherwise a seeded temporary credential could never be replaced.
 */
export const dynamic = 'force-dynamic'

export default async function AdminChangePasswordPage() {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Change your password</h1>
        <p className="mt-1 text-sm text-slate-600">
          {session.mustChangePassword
            ? 'Your account uses a temporary password. Choose a new one to continue.'
            : 'Signed in as ' + session.email}
        </p>
      </div>
      <AdminChangePasswordForm />
    </main>
  )
}
