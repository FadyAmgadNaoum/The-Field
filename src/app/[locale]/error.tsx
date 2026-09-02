'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Container, Section } from '@/components/ui/layout'

/**
 * Error boundary for the public site.
 *
 * ── WHAT IS AND IS NOT SHOWN ─────────────────────────────────────────────────
 * A translated, generic message. Never `error.message`, never a stack trace,
 * never a database error — Next.js already redacts server errors in production,
 * and rendering the message would defeat that in development habits and leak
 * detail if a client-side error carried any (Doc 02 FR-SEC-013).
 *
 * `error.digest` is the correlation id Next.js assigns; it is logged to the
 * browser console for support purposes and deliberately not put on the page.
 */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('common')

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Unhandled error', error.digest)
  }, [error])

  return (
    <Container>
      <Section className="text-center">
        <h1 className="text-heading-lg font-semibold text-ink-900">{t('errorTitle')}</h1>
        <p className="mx-auto mt-3 max-w-prose text-body text-ink-600">{t('errorBody')}</p>
        <div className="mt-8 flex justify-center">
          <Button onClick={reset}>{t('retry')}</Button>
        </div>
      </Section>
    </Container>
  )
}
