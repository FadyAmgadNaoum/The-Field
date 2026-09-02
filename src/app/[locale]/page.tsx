import Image from 'next/image'
import { ArrowRight, CalendarCheck, LayoutGrid, ShieldCheck } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonStyles } from '@/components/ui/button'
import { Alert } from '@/components/ui/feedback'
import { Container, Section } from '@/components/ui/layout'
import { CourtCard } from '@/components/public/court-card'
import { HeroBackdrop } from '@/components/public/court-artwork'
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
      {/*
        Two backdrops, one layout. A CMS hero photograph wins when the owner has
        uploaded one; otherwise the drawn backdrop fills the same space. Either
        way the type sits on a dark ground, so the headline's contrast does not
        depend on which one is showing.
      */}
      <section className="relative isolate overflow-hidden">
        <div aria-hidden className="absolute inset-0 -z-20">
          {heroImageUrl ? (
            <Image
              src={heroImageUrl}
              // Decorative: the headline beside it carries the meaning, so an
              // empty alt is correct and avoids a screen reader announcing a
              // redundant description (Doc 03 NFR-ACC-003).
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover"
            />
          ) : (
            <HeroBackdrop />
          )}
        </div>

        {/*
          Scrim. A photograph's brightness is unknown until it is uploaded, so
          the overlay is what guarantees the 4.5:1 text contrast rather than
          hoping the chosen image is dark enough.
        */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-b from-ink-950/70 via-ink-950/55 to-ink-950/70"
        />

        <Container className="py-20 sm:py-28">
          <div className="max-w-prose">
            <p className="animate-fade-in text-body-sm font-semibold uppercase tracking-[0.2em] text-brand-200">
              {t('heroEyebrow')}
            </p>
            <h1 className="animate-rise-in mt-4 text-display font-semibold tracking-tight text-white sm:text-display-lg">
              {hero['homepage.hero_headline'] ?? t('heroHeadline')}
            </h1>
            <p
              className="animate-rise-in mt-5 text-body-lg text-ink-100"
              // Staggering by a hair makes the block read as one movement
              // settling rather than three things arriving at once.
              style={{ animationDelay: '80ms' }}
            >
              {hero['homepage.hero_subtitle'] ?? t('heroSubtitle')}
            </p>

            <div
              className="animate-rise-in mt-9 flex flex-wrap gap-3"
              style={{ animationDelay: '160ms' }}
            >
              <Link href="/courts" className={buttonStyles({ size: 'lg' })}>
                {hero['homepage.hero_cta_label'] ?? t('heroCta')}
                <ArrowRight
                  aria-hidden
                  className="h-5 w-5 transition-transform duration-300 ease-settle group-hover:translate-x-1 rtl:rotate-180"
                />
              </Link>
              <Link href="/pricing" className={buttonStyles({ variant: 'secondary', size: 'lg' })}>
                {t('heroSecondaryCta')}
              </Link>
            </div>
          </div>
        </Container>
      </section>

      {/* ── What the venue offers ────────────────────────────────────────── */}
      {/*
        Deliberately generic and verifiable: these describe how the booking
        service works, not the facilities. Claiming "floodlit courts" or
        "coaching available" would be inventing facts about a venue that has
        published nothing (Doc 22 Preamble #4).
      */}
      <div className="border-b border-line bg-court-gradient">
        <Container>
          <Section aria-labelledby="home-highlights-heading" className="py-10 sm:py-12">
            <h2 id="home-highlights-heading" className="sr-only">
              {t('highlightsHeading')}
            </h2>
            <ul className="grid gap-5 sm:grid-cols-3">
              {[
                { key: 'choose', Icon: LayoutGrid, tone: 'bg-brand-100 text-brand-800' },
                { key: 'reserve', Icon: CalendarCheck, tone: 'bg-court-100 text-court-800' },
                { key: 'confirm', Icon: ShieldCheck, tone: 'bg-accent-100 text-accent-800' },
              ].map(({ key, Icon, tone }, index) => (
                <li
                  key={key}
                  className="animate-rise-in flex items-start gap-3"
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <span
                    className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control ${tone}`}
                  >
                    <Icon aria-hidden className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-body font-semibold text-ink-900">
                      {t(`highlights.${key}.title` as never)}
                    </p>
                    <p className="mt-1 text-body-sm text-ink-600">
                      {t(`highlights.${key}.body` as never)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        </Container>
      </div>

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
                {previewCourts.map((court, index) => (
                  <CourtCard
                    key={court.id}
                    court={court}
                    showBookAction={false}
                    headingLevel="h3"
                    entranceDelayMs={index * 60}
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
                  className="relative aspect-square overflow-hidden rounded-card bg-ink-100 transition duration-300 ease-settle hover:-translate-y-1 hover:shadow-raised"
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
      <div className="bg-brand-gradient">
        <Container>
          <Section aria-labelledby="home-cta-heading" className="text-center">
            <h2
              id="home-cta-heading"
              className="text-heading font-semibold text-white sm:text-heading-lg"
            >
              {t('ctaHeading')}
            </h2>
            <p className="mx-auto mt-3 max-w-prose text-body text-brand-50">{t('ctaBody')}</p>
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
