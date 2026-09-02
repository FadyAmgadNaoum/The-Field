'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { fetchCsrfToken, mutationHeaders } from './csrf-client'

/**
 * Password change form (Doc 22 M1-T12).
 *
 * Changing the password invalidates every session issued beforehand, including
 * this one, so a successful change sends the administrator back to sign-in.
 * The UI states that up front rather than appearing to fail.
 */
export function AdminChangePasswordForm() {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.')
      return
    }

    setPending(true)
    try {
      const csrfToken = await fetchCsrfToken()
      const response = await fetch('/api/v1/admin/auth/change-password', {
        method: 'POST',
        headers: mutationHeaders(csrfToken),
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const body = (await response.json()) as { success: boolean; error?: { message: string } }

      if (!response.ok || !body.success) {
        setError(body.error?.message ?? 'Could not change the password.')
        return
      }

      router.replace('/admin/login')
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
        <label htmlFor="currentPassword" className="text-sm font-medium text-slate-700">
          Current password
        </label>
        <input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="newPassword" className="text-sm font-medium text-slate-700">
          New password
        </label>
        <input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
        />
        <p className="text-xs text-slate-500">At least 8 characters.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmPassword" className="text-sm font-medium text-slate-700">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <p className="text-xs text-slate-500">
        You will be signed out and asked to sign in again with the new password.
      </p>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Change password'}
      </button>
    </form>
  )
}
