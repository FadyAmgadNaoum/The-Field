import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonStyles } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Container, PageHeader, Section } from '@/components/ui/layout'
import { BookingStatusLookup } from '@/components/public/booking-status-lookup'
import { getCustomerSession } from '@/lib/auth/customer-session'
import { toLocale } from '@/i18n/config'

/**
 * Booking status page (Doc 22 M2-T10, Doc 10 §3.5).
 *
 * ── AUTHENTICATION IS REQUIRED, NOT OPTIONAL ─────────────────────────────────
 * Booking ownership always comes from the session (Doc 24 §E.1). There is no
 * anonymous "reference + phone" lookup and one must never be added: a booking
 * reference is printed on a confirmation and shared over WhatsApp, so treating
 * it as a credential would make every forwarded message a disclosure.
 *
 * The gate here is a courtesy, not the control. A visitor with no session sees
 * a sign-in prompt instead of the form; the API independently returns 401 to
 * any unauthenticated request, so removing this component in a browser gains
 * nothing (Doc 22 §7.2).
 *
 * A sign-in prompt rather than an automatic redirect: the customer arrived here
 * deliberately, and being thrown to another page without explanation reads as a
 * fault. The link carries them back afterwards.
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: toLocale(params.locale), namespace: 'bookingStatus' })
  return {
    title: t('title'),
    description: t('subtitle'),
    // Never index a page whose content is specific to one signed-in customer.
    robots: { index: false, follow: false },
  }
}

export default async function BookingStatusPage({ params }: { params: { locale: string } }) {
  setRequestLocale(toLocale(params.locale))

  const t = await getTranslations('bookingStatus')
  const session = await getCustomerSession()

  return (
    <Container>
      <Section>
        <div className="mx-auto w-full max-w-2xl">
          <PageHeader title={t('title')} description={t('subtitle')} />

          <div className="mt-8">
            {session ? (
              <BookingStatusLookup />
            ) : (
              <Card>
                <CardBody className="flex flex-col gap-4 p-6">
                  <h2 className="text-heading-sm font-semibold text-ink-900">
                    {t('signInRequired')}
                  </h2>
                  <p className="text-body-sm text-ink-600">{t('signInRequiredBody')}</p>
                  <div>
                    <Link
                      href="/signin?redirect=%2Fbooking-status"
                      className={buttonStyles({ size: 'md' })}
                    >
                      {t('signInCta')}
                    </Link>
                  </div>
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      </Section>
    </Container>
  )
}
