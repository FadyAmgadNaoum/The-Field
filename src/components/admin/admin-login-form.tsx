'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { fetchCsrfToken, mutationHeaders } from './csrf-client'

/**
 * Administrator sign-in form (Doc 22 M1-T07).
 *
 * Requirements met here:
 *   - inputs carry real <label> elements, not placeholder-only (Doc 03 NFR-ACC-004)
 *   - one generic error for every failure, so the form cannot be used to
 *     discover which addresses exist (Doc 08 §2)
 *   - the submit button is disabled while a request is in flight
 */
export function AdminLoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      const csrfToken = await fetchCsrfToken()
      const response = await fetch('/api/v1/admin/auth/login', {
        method: 'POST',
        headers: mutationHeaders(csrfToken),
        body: JSON.stringify({ email, password }),
      })
      const body = (await response.json()) as {
        success: boolean
        data?: { mustChangePassword: boolean }
        error?: { message: string }
      }

      if (!response.ok || !body.success) {
        setError(body.error?.message ?? 'Sign-in failed. Please try again.')
        return
      }

      router.replace(body.data?.mustChangePassword ? '/admin/change-password' : '/admin/dashboard')
      router.refresh()
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-slate-700">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
