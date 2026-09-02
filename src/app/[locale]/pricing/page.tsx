import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { Card, CardBody } from '@/components/ui/card'
import { Container, PageHeader, Section } from '@/components/ui/layout'
import { CourtMotif } from '@/components/public/court-artwork'
import { venueConfig } from '@/lib/config'
import { toLocale } from '@/i18n/config'
import { formatDayList, formatMoney, formatTimeRange } from '@/lib/ui/format'
import * as courtsService from '@/modules/courts/courts.service'
import * as pricingService from '@/modules/pricing/pricing.service'

/**
 * Public pricing page (Doc 22 M2-T06).
 *
 * ── THE PRICE SHOWN IS NOT THE PRICE CHARGED ─────────────────────────────────
 * This page publishes the venue's rate card: the rows an administrator entered
 * in `court_pricing_rules`. It performs no calculation. When the booking engine
 * lands in Milestone 3, the amount written to a booking is computed on the
 * server from these same rows at creation time and is never accepted from a
 * client (Doc 13 T-007, Doc 24 §M item 5).
 *
 * The note at the foot of the page states that relationship to the customer, so
 * the published card is understood as reference information rather than as a
 * quote the browser could carry into a booking.
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: toLocale(params.locale), namespace: 'pricing' })
  return { title: t('title'), description: t('subtitle') }
}

export default async function PricingPage({ params }: { params: { locale: string } }) {
  const locale = toLocale(params.locale)
  setRequestLocale(locale)

  const t = await getTranslations('pricing')

  const courts = await courtsService.getActiveCourts(venueConfig.id)
  const pricing = await pricingService.getPricingForCourts(
    venueConfig.id,
    courts.map((court) => court.id),
  )

  const rulesByCourt = new Map(pricing.map((entry) => [entry.courtId, entry.rules]))
  const hasAnyRule = pricing.some((entry) => entry.rules.length > 0)

  return (
    <Container>
      <Section>
        <PageHeader title={t('title')} description={t('subtitle')} />

        {courts.length === 0 || !hasAnyRule ? (
          <div className="mt-10">
            <EmptyState
              title={t('empty')}
              description={t('emptyBody')}
              illustration={<CourtMotif />}
            />
          </div>
        ) : (
          <div className="mt-10 flex flex-col gap-6">
            {courts.map((court) => {
              const rules = rulesByCourt.get(court.id) ?? []

              return (
                <Card key={court.id}>
                  <CardBody>
                    <h2 className="text-heading-sm font-semibold text-ink-900">{court.name}</h2>

                    {rules.length === 0 ? (
                      <p className="mt-3 text-body-sm text-ink-500">{t('noRulesForCourt')}</p>
                    ) : (
                      /*
                        A table is the honest markup for a rate card: a screen
                        reader announces each cell with its column header, which
                        a stack of divs cannot do. It scrolls inside its own
                        container so a wide card never widens the page at 390px.
                      */
                      <div className="mt-4 -mx-5 overflow-x-auto px-5">
                        <table className="w-full min-w-[32rem] border-collapse text-start">
                          <caption className="sr-only">
                            {t('title')} — {court.name}
                          </caption>
                          <thead>
                            <tr className="border-b border-line">
                              <th
                                scope="col"
                                className="py-2 pe-4 text-start text-body-sm font-semibold text-ink-700"
                              >
                                {court.name}
                              </th>
                              <th
                                scope="col"
                                className="py-2 pe-4 text-start text-body-sm font-semibold text-ink-700"
                              >
                                {t('daysLabel')}
                              </th>
                              <th
                                scope="col"
                                className="py-2 pe-4 text-start text-body-sm font-semibold text-ink-700"
                              >
                                {t('timeLabel')}
                              </th>
                              <th
                                scope="col"
                                className="py-2 text-end text-body-sm font-semibold text-ink-700"
                              >
                                {t('perHour')}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {rules.map((rule) => (
                              <tr key={rule.id} className="border-b border-line last:border-0">
                                <th
                                  scope="row"
                                  className="py-3 pe-4 text-start text-body-sm font-medium text-ink-900"
                                >
                                  {rule.label}
                                </th>
                                <td className="py-3 pe-4 text-body-sm text-ink-600">
                                  {formatDayList(locale, rule.applicableDays, t('allDays'))}
                                </td>
                                <td className="py-3 pe-4 text-body-sm text-ink-600">
                                  {formatTimeRange(locale, rule.startTime, rule.endTime)}
                                </td>
                                <td className="py-3 text-end text-body-sm font-semibold text-ink-900">
                                  {formatMoney(locale, rule.priceAmount, rule.currency)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardBody>
                </Card>
              )
            })}

            <Alert tone="info" title={t('authorityNoteHeading')}>
              <p>{t('authorityNoteBody')}</p>
            </Alert>
          </div>
        )}
      </Section>
    </Container>
  )
}
