import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Badge, Card, CardBody } from '@/components/ui/card'
import { buttonStyles } from '@/components/ui/button'
import { BOOKING_CTA_HREF } from '@/components/layout/nav-items'
import type { PublicCourt } from '@/modules/courts/courts.service'

/**
 * Court card (Doc 22 M2-T07, Doc 24 §D.5).
 *
 * ── IMAGES ───────────────────────────────────────────────────────────────────
 * The URL arrives already resolved from the storage key by the courts service,
 * so no template ever handles an internal object key (Doc 12 §3).
 *
 * A court with no photo gets a plain tinted panel, not a broken image and not a
 * stock photograph — no production imagery has been supplied and inventing one
 * would misrepresent the venue.
 *
 * `alt` prefers the administrator's `alt_text` (Doc 03 NFR-ACC-003 requires
 * meaningful alt text) and falls back to a translated description naming the
 * court, which is still more useful to a screen reader than an empty string.
 */
export async function CourtCard({
  court,
  showBookAction = true,
  headingLevel = 'h2',
}: {
  court: PublicCourt
  showBookAction?: boolean
  /**
   * The card's heading level depends on where it sits.
   *
   * On the courts page the cards follow the page `h1` directly, so they are
   * `h2`. On the home page they sit inside a section that already has an `h2`,
   * so they are `h3`. Hardcoding either one makes the document outline skip a
   * level on the other page — which is exactly what Lighthouse's `heading-order`
   * audit flagged on `/courts` before this prop existed (Doc 03 NFR-ACC-001).
   */
  headingLevel?: 'h2' | 'h3'
}) {
  const t = await getTranslations('courts')
  const cover = court.images[0]
  const Heading = headingLevel
  const FeatureHeading = headingLevel === 'h2' ? 'h3' : 'h4'

  return (
    <Card as="li" className="flex flex-col">
      <div className="relative aspect-[16/10] w-full bg-brand-50">
        {cover?.url ? (
          <Image
            src={cover.url}
            alt={cover.altText ?? t('photoAlt', { court: court.name })}
            fill
            // Two columns from `sm`, three from `lg`; telling the browser this
            // up front avoids downloading a full-width image on a phone.
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-4 text-center">
            <span className="text-body-sm text-brand-800">{t('noPhoto')}</span>
          </div>
        )}
      </div>

      <CardBody className="flex flex-1 flex-col gap-3">
        <div>
          <Heading className="text-heading-sm font-semibold text-ink-900">{court.name}</Heading>
          {court.description ? (
            <p className="mt-1 text-body-sm text-ink-600">{court.description}</p>
          ) : null}
        </div>

        {court.features.length > 0 ? (
          <div>
            <FeatureHeading className="sr-only">{t('featuresHeading')}</FeatureHeading>
            <ul className="flex flex-wrap gap-1.5">
              {court.features.map((feature) => (
                <li key={feature}>
                  <Badge tone="brand">{feature}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {showBookAction ? (
          <div className="mt-auto pt-2">
            <Link
              href={BOOKING_CTA_HREF}
              className={buttonStyles({ variant: 'secondary', size: 'sm' })}
            >
              {t('bookThisCourt')}
            </Link>
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}
