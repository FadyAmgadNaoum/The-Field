import Image from 'next/image'
import { ArrowRight } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonStyles } from '@/components/ui/button'
import { Alert } from '@/components/ui/feedback'
import { Container, Section } from '@/components/ui/layout'
import { CourtCard } from '@/components/public/court-card'
import { venueConfig } from '@/lib/config'
import { publicUrlFor } from '@/modules/storage/storage.service'
import { toLocale } from '@/i18n/config'
import * as cms from '@/modules/cms/cms.service'
import * as courtsService from '@/modules/courts/courts.service'

/**
 * Home page (Doc 22 M2-T05).
 *
 * A React Server Component that reads the database directly through service
 * functions. There is no client-side fetch for any of this content, so the page
 * arrives complete in the first response (Doc 09 §5, Doc 22 §10.4).
 *
 * ── EVERY SECTION DEGRADES ───────────────────────────────────────────────────
 * Hero copy, the about text, the announcements banner, the gallery strip and
 * the courts grid are all CMS or venue data that starts empty (Doc 24 §D.4).
 * M2-T05's acceptance criterion is that the page renders without error when all
 * of it is absent, so each section either falls back to a translated neutral
 * string or is omitted entirely. Nothing here invents a business claim.
 */

export const dynamic = 'force-dynamic'

export default async function HomePage({ params }: { params: { locale: string } }) {
  setRequestLocale(toLocale(params.locale))

  const t = await getTranslations('home')

  const [hero, about, announcements, courts, gallery] = await Promise.all([
    cms.getSettingGroup(venueConfig.id, 'homepage'),
    cms.getSettingGroup(venueConfig.id, 'about'),
    cms.getActiveAnnouncements(venueConfig.id),
    courtsService.getActiveCourts(venueConfig.id),
    cms.getGalleryItems(venueConfig.id, true),
  ])

  const heroImageUrl = publicUrlFor(hero['homepage.hero_image_key'])
  const previewCourts = courts.slice(0, 3)
  const previewGallery = gallery.slice(0, 4)

  return (
    <>
      {announcements.length > 0 ? (
        <Container as="section" aria-label={t('announcementsLabel')} className="pt-6">
          <ul className="flex flex-col gap-3">
            {announcements.map((announcement) => (
              <li key={announcement.id}>
                {/* Announcement text is admin-authored and rendered as text. */}
                <Alert tone="info" title={announcement.title}>
                  <p className="whitespace-pre-line">{announcement.body}</p>
                </Alert>
              </li>
            ))}
          </ul>
        </Container>
      ) : null}

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden bg-brand-50">
        {heroImageUrl ? (
          <>
            <Image
              src={heroImageUrl}
              // Decorative: the headline beside it carries the meaning, so an
              // empty alt is correct and avoids a screen reader announcing a
              // redundant description (Doc 03 NFR-ACC-003).
              alt=""
              fill
              priority
              sizes="100vw"
              className="-z-10 object-cover"
            />
            <div aria-hidden className="absolute inset-0 -z-10 bg-ink-950/55" />
          </>
        ) : null}

        <Container className="py-16 sm:py-24">
          <div className="max-w-prose">
            <h1
              className={`text-display font-semibold tracking-tight sm:text-display-lg ${
                heroImageUrl ? 'text-white' : 'text-ink-900'
              }`}
            >
              {hero['homepage.hero_headline'] ?? t('heroHeadline')}
            </h1>
            <p className={`mt-4 text-body-lg ${heroImageUrl ? 'text-ink-100' : 'text-ink-700'}`}>
              {hero['homepage.hero_subtitle'] ?? t('heroSubtitle')}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/courts" className={buttonStyles({ size: 'lg' })}>
                {hero['homepage.hero_cta_label'] ?? t('heroCta')}
                <ArrowRight aria-hidden className="h-5 w-5 rtl:rotate-180" />
              </Link>
              <Link href="/pricing" className={buttonStyles({ variant: 'secondary', size: 'lg' })}>
                {t('heroSecondaryCta')}
              </Link>
            </div>
          </div>
        </Container>
      </section>

      {/* ── About ────────────────────────────────────────────────────────── */}
      <Container>
        <Section aria-labelledby="home-about-heading">
          <div className="max-w-prose">
            <h2
              id="home-about-heading"
              className="text-heading font-semibold text-ink-900 sm:text-heading-lg"
            >
              {about['about.headline'] ?? t('aboutHeading')}
            </h2>
            {/*
              `about.body` is sanitised at write time (Doc 22 §10.6) and is
              still rendered as TEXT here, never with dangerouslySetInnerHTML —
              React escapes it a second time, so a sanitiser bypass would be
              displayed rather than executed.
            */}
            <p className="mt-4 whitespace-pre-line text-body text-ink-600">
              {about['about.body'] ?? t('aboutBody')}
            </p>
          </div>
        </Section>
      </Container>

      {/* ── Courts preview ───────────────────────────────────────────────── */}
      <div className="bg-subtle">
        <Container>
          <Section aria-labelledby="home-courts-heading">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-prose">
                <h2
                  id="home-courts-heading"
                  className="text-heading font-semibold text-ink-900 sm:text-heading-lg"
                >
                  {t('courtsHeading')}
                </h2>
                <p className="mt-2 text-body text-ink-600">{t('courtsSubtitle')}</p>
              </div>
              {previewCourts.length > 0 ? (
                <Link href="/courts" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
                  {t('viewAllCourts')}
                </Link>
              ) : null}
            </div>

            {previewCourts.length > 0 ? (
              <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {previewCourts.map((court) => (
                  <CourtCard
                    key={court.id}
                    court={court}
                    showBookAction={false}
                    headingLevel="h3"
                  />
                ))}
              </ul>
            ) : (
              <p className="mt-6 text-body text-ink-500">{t('courtsEmpty')}</p>
            )}
          </Section>
        </Container>
      </div>

      {/* ── Gallery strip ────────────────────────────────────────────────── */}
      {previewGallery.length > 0 ? (
        <Container>
          <Section aria-labelledby="home-gallery-heading">
            <h2
              id="home-gallery-heading"
              className="text-heading font-semibold text-ink-900 sm:text-heading-lg"
            >
              {t('galleryHeading')}
            </h2>
            <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {previewGallery.map((item) => (
                <li
                  key={item.id}
                  className="relative aspect-square overflow-hidden rounded-card bg-ink-100"
                >
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt={item.caption ?? ''}
                      fill
                      sizes="(min-width: 640px) 25vw, 50vw"
                      className="object-cover"
                    />
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <Link href="/gallery" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
                {t('viewGallery')}
              </Link>
            </div>
          </Section>
        </Container>
      ) : null}

      {/* ── Closing call to action ───────────────────────────────────────── */}
      <div className="bg-brand-800">
        <Container>
          <Section aria-labelledby="home-cta-heading" className="text-center">
            <h2
              id="home-cta-heading"
              className="text-heading font-semibold text-white sm:text-heading-lg"
            >
              {t('ctaHeading')}
            </h2>
            <p className="mx-auto mt-3 max-w-prose text-body text-brand-100">{t('ctaBody')}</p>
            <div className="mt-7 flex justify-center">
              <Link href="/courts" className={buttonStyles({ variant: 'secondary', size: 'lg' })}>
                {t('ctaButton')}
              </Link>
            </div>
          </Section>
        </Container>
      </div>
    </>
  )
}
