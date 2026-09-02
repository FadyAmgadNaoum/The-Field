import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonStyles } from '@/components/ui/button'
import { Alert } from '@/components/ui/feedback'
import { Card, CardBody } from '@/components/ui/card'
import { Container, Section } from '@/components/ui/layout'
import { SignInForm } from '@/components/public/sign-in-form'
import { getCustomerSession } from '@/lib/auth/customer-session'
import { sanitiseRedirectTarget } from '@/lib/auth/google'
import { toLocale } from '@/i18n/config'

/**
 * Customer sign-in page (Doc 23 REL-M2-T04).
 *
 * ── THE REDIRECT PARAMETER ───────────────────────────────────────────────────
 * `?redirect=` preserves where the customer was heading. It is passed through
 * `sanitiseRedirectTarget` HERE, on the server, before it reaches the client
 * component or any anchor — so a crafted link cannot turn the sign-in page into
 * an open redirect (Doc 23 §16.4). The same function guards the OAuth flow, so
 * both entry points share one rule.
 *
 * An already-authenticated visitor is not bounced automatically: a silent
 * redirect from a page they deliberately opened is disorienting. They are told
 * they are signed in and given the link.
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: toLocale(params.locale), namespace: 'signin' })
  return { title: t('title'), description: t('subtitle') }
}

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: { locale: string }
  searchParams: { redirect?: string }
}) {
  setRequestLocale(toLocale(params.locale))

  const t = await getTranslations('signin')
  const session = await getCustomerSession()

  // Locale-relative: the client router from `@/i18n/navigation` re-applies the
  // active locale prefix, so this must not already contain one.
  const redirectTo = sanitiseRedirectTarget(searchParams.redirect, '/booking-status')

  return (
    <Container>
      <Section>
        <div className="mx-auto w-full max-w-md">
          <Card>
            <CardBody className="p-6 sm:p-8">
              {session ? (
                <div className="flex flex-col gap-5">
                  <Alert tone="success">
                    <p>{t('alreadySignedIn', { email: session.email })}</p>
                  </Alert>
                  <Link href="/booking-status" className={buttonStyles({ fullWidth: true })}>
                    {t('goToBookingStatus')}
                  </Link>
                </div>
              ) : (
                <SignInForm redirectTo={redirectTo} />
              )}
            </CardBody>
          </Card>
        </div>
      </Section>
    </Container>
  )
}
