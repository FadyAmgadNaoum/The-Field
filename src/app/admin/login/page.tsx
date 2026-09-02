import { redirect } from 'next/navigation'
import { getAdminSession } from '@/lib/auth/admin-session'
import { AdminLoginForm } from '@/components/admin/admin-login-form'

/**
 * Administrator sign-in page (Doc 22 M1-T07).
 *
 * Deliberately OUTSIDE the guarded route group, otherwise the guard would
 * redirect this page to itself.
 *
 * The CSRF token is NOT minted here: Next.js forbids setting cookies during a
 * page render. The form requests one from /api/v1/csrf immediately before it
 * submits (Doc 24 §E.4).
 */
export const dynamic = 'force-dynamic'

export default async function AdminLoginPage() {
  const session = await getAdminSession()
  if (session) {
    redirect(session.mustChangePassword ? '/admin/change-password' : '/admin/dashboard')
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">The Field</h1>
        <p className="mt-1 text-sm text-slate-600">Administrator sign-in</p>
      </div>
      <AdminLoginForm />
    </main>
  )
}
