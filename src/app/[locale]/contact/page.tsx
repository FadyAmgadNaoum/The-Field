import type { Metadata } from 'next'
import { ExternalLink, Mail, MapPin, MessageCircle, Phone } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Card, CardBody } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
import { Container, PageHeader, Section } from '@/components/ui/layout'
import { venueConfig } from '@/lib/config'
import { toLocale } from '@/i18n/config'
import * as cms from '@/modules/cms/cms.service'

/**
 * Public contact page (Doc 22 M2-T06).
 *
 * ── NOTHING IS INVENTED ──────────────────────────────────────────────────────
 * Every value on this page comes from `cms_site_settings`, which ships empty
 * (Doc 22 §10.2, Doc 24 §D.4). There is no example phone number, no
 * info@thefield.eg, no street address anywhere in this file — a fabricated
 * contact detail on a real venue's contact page is worse than an empty one,
 * because a customer would act on it. When nothing is configured the page says
 * so and renders nothing else.
 *
 * ── ON THE MAP EMBED ─────────────────────────────────────────────────────────
 * Doc 22 M2-T06 describes a sandboxed `<iframe>` for the map. It is rendered
 * here as an external LINK instead, for two reasons that both point the same
 * way:
 *
 *   1. The Content-Security-Policy in `src/middleware.ts` has no `frame-src`
 *      directive, so `default-src 'self'` applies and any third-party frame is
 *      blocked. Admitting one means relaxing the CSP for the whole site.
 *   2. No map provider has been chosen by the venue owner, so there is no
 *      specific origin to allow — the relaxation would have to be broad.
 *
 * Weakening the site's CSP for a feature whose provider is undecided is not a
 * trade this milestone should make. Recorded in the Milestone 2 report as a
 * deviation with the condition for revisiting it: once the owner names a map
 * provider, a single `frame-src` origin can be added and the link becomes an
 * embed. The customer-facing outcome — reaching the venue location — works
 * today.
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: toLocale(params.locale), namespace: 'contact' })
  return { title: t('title'), description: t('subtitle') }
}

export default async function ContactPage({ params }: { params: { locale: string } }) {
  setRequestLocale(toLocale(params.locale))

  const t = await getTranslations('contact')
  const settings = await cms.getSettingGroup(venueConfig.id, 'contact')

  const phone = settings['venue.phone']
  const whatsapp = settings['venue.whatsapp']
  const email = settings['venue.email']
  const address = settings['venue.address']
  const mapUrl = settings['venue.map_embed_url']

  const hasAnything = Boolean(phone || whatsapp || email || address || mapUrl)
  const whatsappDigits = whatsapp?.replace(/\D/g, '') ?? ''

  return (
    <Container>
      <Section>
        <PageHeader title={t('title')} description={t('subtitle')} />

        {!hasAnything ? (
          <div className="mt-10">
            <EmptyState title={t('empty')} description={t('emptyBody')} />
          </div>
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {phone ? (
              <Card>
                <CardBody className="flex items-start gap-3">
                  <Phone aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-ink-500" />
                  <div className="min-w-0">
                    <h2 className="text-body-sm font-semibold text-ink-900">{t('phone')}</h2>
                    {/* A phone number reads left-to-right even inside RTL text. */}
                    <a
                      href={`tel:${phone}`}
                      dir="ltr"
                      className="mt-1 inline-block text-body text-brand-800 hover:underline"
                    >
                      {phone}
                    </a>
                  </div>
                </CardBody>
              </Card>
            ) : null}

            {whatsappDigits ? (
              <Card>
                <CardBody className="flex items-start gap-3">
                  <MessageCircle aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-ink-500" />
                  <div className="min-w-0">
                    <h2 className="text-body-sm font-semibold text-ink-900">{t('whatsapp')}</h2>
                    <a
                      href={`https://wa.me/${whatsappDigits}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1.5 text-body text-brand-800 hover:underline"
                    >
                      {t('openWhatsapp')}
                      <ExternalLink aria-hidden className="h-4 w-4" />
                    </a>
                  </div>
                </CardBody>
              </Card>
            ) : null}

            {email ? (
              <Card>
                <CardBody className="flex items-start gap-3">
                  <Mail aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-ink-500" />
                  <div className="min-w-0">
                    <h2 className="text-body-sm font-semibold text-ink-900">{t('email')}</h2>
                    <a
                      href={`mailto:${email}`}
                      dir="ltr"
                      className="mt-1 inline-block break-all text-body text-brand-800 hover:underline"
                    >
                      {email}
                    </a>
                  </div>
                </CardBody>
              </Card>
            ) : null}

            {address ? (
              <Card>
                <CardBody className="flex items-start gap-3">
                  <MapPin aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-ink-500" />
                  <div className="min-w-0">
                    <h2 className="text-body-sm font-semibold text-ink-900">{t('address')}</h2>
                    <p className="mt-1 whitespace-pre-line text-body text-ink-700">{address}</p>
                    {mapUrl ? (
                      <a
                        href={mapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1.5 text-body-sm text-brand-800 hover:underline"
                      >
                        {t('openInMaps')}
                        <ExternalLink aria-hidden className="h-4 w-4" />
                      </a>
                    ) : null}
                  </div>
                </CardBody>
              </Card>
            ) : null}

            {mapUrl && !address ? (
              <Card>
                <CardBody className="flex items-start gap-3">
                  <MapPin aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-ink-500" />
                  <div className="min-w-0">
                    <h2 className="text-body-sm font-semibold text-ink-900">{t('mapHeading')}</h2>
                    <a
                      href={mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1.5 text-body text-brand-800 hover:underline"
                    >
                      {t('openInMaps')}
                      <ExternalLink aria-hidden className="h-4 w-4" />
                    </a>
                  </div>
                </CardBody>
              </Card>
            ) : null}
          </div>
        )}
      </Section>
    </Container>
  )
}
