import type { Metadata } from 'next'
import { Clock } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Card, CardBody } from '@/components/ui/card'
import { Container, PageHeader, Section } from '@/components/ui/layout'
import { venueConfig } from '@/lib/config'
import { toLocale } from '@/i18n/config'
import { formatTimeRange, formatWeekday } from '@/lib/ui/format'
import * as cms from '@/modules/cms/cms.service'
import * as venueService from '@/modules/venue/venue.service'

/**
 * About page (Doc 22 M2-T06).
 *
 * ── OPERATING HOURS AND OBD-004 ──────────────────────────────────────────────
 * OBD-004 — the venue's exact operating days and hours — is an unresolved owner
 * decision (Doc 24 §L). `operating_hours` is therefore not seeded and this page
 * shows "Opening hours coming soon" rather than the 08:00–24:00 that appears as
 * a provisional assumption in Doc 01 Q8. Displaying an assumed schedule would
 * turn a placeholder into a customer-facing commitment.
 *
 * The body text is CMS content, sanitised at write time (Doc 22 §10.6) and
 * rendered as text here — never with dangerouslySetInnerHTML.
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: toLocale(params.locale), namespace: 'about' })
  return { title: t('title') }
}

export default async function AboutPage({ params }: { params: { locale: string } }) {
  const locale = toLocale(params.locale)
  setRequestLocale(locale)

  const t = await getTranslations('about')

  const [about, hours] = await Promise.all([
    cms.getSettingGroup(venueConfig.id, 'about'),
    venueService.getOperatingHours(venueConfig.id),
  ])

  const activeHours = hours.filter((row) => row.isActive)

  return (
    <Container>
      <Section>
        <PageHeader title={about['about.headline'] ?? t('title')} />

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="max-w-prose">
            <p className="whitespace-pre-line text-body text-ink-700">
              {about['about.body'] ?? t('bodyFallback')}
            </p>
          </div>

          <Card as="section" aria-labelledby="opening-hours-heading" className="h-fit">
            <CardBody>
              <h2
                id="opening-hours-heading"
                className="flex items-center gap-2 text-heading-sm font-semibold text-ink-900"
              >
                <Clock aria-hidden className="h-5 w-5 text-ink-500" />
                {t('hoursHeading')}
              </h2>

              {activeHours.length > 0 ? (
                <dl className="mt-4 flex flex-col gap-2">
                  {activeHours.map((row) => (
                    <div key={row.dayOfWeek} className="flex justify-between gap-4 text-body-sm">
                      <dt className="text-ink-700">{formatWeekday(locale, row.dayOfWeek)}</dt>
                      <dd className="text-ink-900">
                        {formatTimeRange(locale, row.openTime, row.closeTime)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-4 text-body-sm text-ink-500">{t('hoursEmpty')}</p>
              )}
            </CardBody>
          </Card>
        </div>
      </Section>
    </Container>
  )
}
