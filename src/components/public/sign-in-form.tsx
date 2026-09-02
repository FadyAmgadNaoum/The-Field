'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Button, buttonStyles } from '@/components/ui/button'
import { Alert, Spinner } from '@/components/ui/feedback'
import { Field, inputStyles } from '@/components/ui/field'
import { ApiRequestError, postJson } from '@/lib/ui/api-client'

/**
 * Customer sign-in and registration (Doc 23 REL-M2-T04, Doc 10 §3.1).
 *
 * ── ONE FORM, TWO MODES ──────────────────────────────────────────────────────
 * Sign-in and registration differ by one field and one endpoint. Keeping them
 * in one component means the error handling, the double-submit guard and the
 * post-success redirect are written once and behave identically.
 *
 * ── WHAT THE BROWSER IS NOT TRUSTED WITH ─────────────────────────────────────
 * Nothing here decides anything. The server validates the credentials, mints
 * the session cookie, and owns the account record; this component sends two
 * strings and renders what comes back. Client-side length checks exist only so
 * a customer learns about a short password before a round trip — the real
 * policy lives in `customerRegisterSchema` (Doc 24 §M item 3).
 *
 * ── NO "FORGOT PASSWORD" ─────────────────────────────────────────────────────
 * Password reset is out of scope for V1 and REL-M2-T04 requires the UI not to
 * imply it exists. There is deliberately no link.
 */

type Mode = 'signin' | 'register'

export function SignInForm({ redirectTo }: { redirectTo: string }) {
  const t = useTranslations('signin')
  const tErrors = useTranslations('errors')
  const locale = useLocale()
  const router = useRouter()

  const [mode, setMode] = useState<Mode>('signin')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({})

  const isRegister = mode === 'register'

  function switchMode(next: Mode) {
    setMode(next)
    setFormError(null)
    setFieldErrors({})
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    // Double-submit guard. A second submission while the first is in flight
    // would create two accounts or consume two rate-limit points.
    if (isSubmitting) return

    setIsSubmitting(true)
    setFormError(null)
    setFieldErrors({})

    const form = new FormData(event.currentTarget)
    const payload = isRegister
      ? {
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
          fullName: String(form.get('fullName') ?? ''),
        }
      : {
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
        }

    try {
      await postJson(isRegister ? '/api/v1/auth/register' : '/api/v1/auth/login', payload)

      // `redirectTo` was sanitised on the server before it reached this
      // component, so it is always a same-origin relative path.
      router.push(redirectTo)
      router.refresh()
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setFieldErrors({
          email: error.fieldError('email'),
          password: error.fieldError('password'),
          fullName: error.fieldError('fullName'),
        })

        // Prefer the server's own message; fall back to the translated
        // catalogue entry for the code so the customer never sees an
        // untranslated or empty string.
        setFormError(error.message || tErrors(error.code as never))
      } else {
        setFormError(tErrors('INTERNAL_ERROR'))
      }
      setIsSubmitting(false)
    }
  }

  const submitLabel = isRegister ? t('registerSubmit') : t('submit')
  const submittingLabel = isRegister ? t('registerSubmitting') : t('submitting')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading-lg font-semibold text-ink-900">
          {isRegister ? t('registerTitle') : t('title')}
        </h1>
        <p className="mt-2 text-body-sm text-ink-600">
          {isRegister ? t('registerSubtitle') : t('subtitle')}
        </p>
      </div>

      {/*
        Google Sign-In is a plain link, not a fetch. Doc 24 §E.2 requires a GET
        navigation so the flow does not interact with the `form-action 'self'`
        CSP directive. The redirect target travels as a query parameter and is
        re-sanitised server-side before it is stored.
      */}
      <a
        href={`/api/v1/auth/google/start?redirect=${encodeURIComponent(`/${locale}${redirectTo}`)}`}
        className={buttonStyles({ variant: 'secondary', fullWidth: true })}
      >
        {t('googleButton')}
      </a>

      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        <span className="text-body-sm text-ink-500">{t('or')}</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? (
          <Alert tone="danger" live="assertive">
            <p>{formError}</p>
          </Alert>
        ) : null}

        {isRegister ? (
          <Field label={t('fullNameLabel')} required error={fieldErrors.fullName}>
            {(props) => (
              <input
                {...props}
                name="fullName"
                type="text"
                autoComplete="name"
                required
                maxLength={255}
                className={inputStyles}
              />
            )}
          </Field>
        ) : null}

        <Field label={t('emailLabel')} required error={fieldErrors.email}>
          {(props) => (
            <input
              {...props}
              name="email"
              type="email"
              // An email address is left-to-right even in an RTL layout.
              dir="ltr"
              autoComplete="email"
              required
              maxLength={255}
              className={inputStyles}
            />
          )}
        </Field>

        <Field
          label={t('passwordLabel')}
          required
          help={isRegister ? t('passwordHint') : undefined}
          error={fieldErrors.password}
        >
          {(props) => (
            <input
              {...props}
              name="password"
              type="password"
              dir="ltr"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              required
              minLength={isRegister ? 8 : undefined}
              className={inputStyles}
            />
          )}
        </Field>

        <Button type="submit" fullWidth disabled={isSubmitting}>
          {isSubmitting ? <Spinner label={submittingLabel} /> : submitLabel}
        </Button>
      </form>

      <p className="text-center text-body-sm text-ink-600">
        {isRegister ? t('haveAccount') : t('noAccount')}{' '}
        <button
          type="button"
          onClick={() => switchMode(isRegister ? 'signin' : 'register')}
          className="inline-flex min-h-touch items-center px-1 font-medium text-brand-800 underline hover:text-brand-900"
        >
          {isRegister ? t('signInInstead') : t('createAccount')}
        </button>
      </p>
    </div>
  )
}
