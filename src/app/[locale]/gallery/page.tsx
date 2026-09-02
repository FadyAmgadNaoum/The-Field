import type { Metadata } from 'next'
import Image from 'next/image'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { EmptyState } from '@/components/ui/feedback'
import { Container, PageHeader, Section } from '@/components/ui/layout'
import { CourtMotif } from '@/components/public/court-artwork'
import { venueConfig } from '@/lib/config'
import { toLocale } from '@/i18n/config'
import * as cms from '@/modules/cms/cms.service'

/**
 * Public gallery page (Doc 22 M2-T06, Doc 09 §6.3).
 *
 * ── NO PLACEHOLDER IMAGERY ───────────────────────────────────────────────────
 * `cms_gallery_items` starts empty and no production photographs exist. The
 * page ships with the real grid and a genuine empty state — not stock imagery,
 * which would misrepresent the venue on its own website. Once an administrator
 * uploads through `/admin/cms/gallery`, images appear here with no code change.
 *
 * ── ALT TEXT ─────────────────────────────────────────────────────────────────
 * The caption is the alt text when one exists. When it does not, the alt is
 * empty and the image is treated as decorative — which is correct: an
 * uncaptioned photograph in a gallery grid carries no information a screen
 * reader user loses, and a generated description like "gallery image 3" is
 * noise rather than help (Doc 03 NFR-ACC-003).
 *
 * ── NO LIGHTBOX AT THIS MILESTONE ────────────────────────────────────────────
 * Doc 09 §6.3 mentions a lightbox. A modal image viewer needs focus trapping,
 * escape handling and scroll locking to be accessible, and it ships JavaScript
 * to every visitor. Each image links to its full-size file instead, which the
 * browser presents natively and which works without script.
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: toLocale(params.locale), namespace: 'gallery' })
  return { title: t('title'), description: t('subtitle') }
}

export default async function GalleryPage({ params }: { params: { locale: string } }) {
  setRequestLocale(toLocale(params.locale))

  const t = await getTranslations('gallery')
  const items = (await cms.getGalleryItems(venueConfig.id, true)).filter(
    (item) => item.imageUrl !== null,
  )

  return (
    <Container>
      <Section>
        <PageHeader title={t('title')} description={t('subtitle')} />

        {items.length === 0 ? (
          <div className="mt-10">
            <EmptyState
              title={t('empty')}
              description={t('emptyBody')}
              illustration={<CourtMotif />}
            />
          </div>
        ) : (
          <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => (
              <li key={item.id}>
                <figure>
                  <a
                    href={item.imageUrl as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative block aspect-square overflow-hidden rounded-card bg-ink-100"
                  >
                    <Image
                      src={item.imageUrl as string}
                      alt={item.caption ?? ''}
                      fill
                      sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                      className="object-cover transition-transform duration-200 hover:scale-105"
                    />
                  </a>
                  {item.caption ? (
                    <figcaption className="mt-2 text-body-sm text-ink-600">
                      {item.caption}
                    </figcaption>
                  ) : null}
                </figure>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Container>
  )
}
