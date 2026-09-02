import type { Metadata, Viewport } from 'next'
import { Cairo, Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { SiteFooter } from '@/components/layout/site-footer'
import { SiteHeader } from '@/components/layout/site-header'
import { WhatsAppButton } from '@/components/layout/whatsapp-button'
import { venueConfig } from '@/lib/config'
import { directionFor, isLocale, LOCALES, type Locale } from '@/i18n/config'
import * as cms from '@/modules/cms/cms.service'
import * as venueService from '@/modules/venue/venue.service'
import '../globals.css'

/**
 * Public site root layout (Doc 22 M2-T04, Doc 23 REL-M2-T01).
 *
 * ── WHY THIS IS A ROOT LAYOUT ────────────────────────────────────────────────
 * `dir` must be set on the `<html>` element itself — Gate M2 checks exactly
 * that — and only a root layout renders `<html>`. The administrator dashboard
 * is English-only in V1, so it has its own root layout at
 * `src/app/admin/layout.tsx` and there is deliberately no `src/app/layout.tsx`.
 * Next.js supports this: each subtree has one layout that owns the document.
 *
 * ── SHARED DATA ──────────────────────────────────────────────────────────────
 * The venue name, tagline, contact details and social links are needed by the
 * header and footer on every page, so they are loaded once here rather than by
 * each page. All of them are CMS values that start unset; each consumer handles
 * absence rather than substituting a placeholder (Doc 22 §10.5).
 */

/**
 * Fonts (Doc 23 REL-M2-T01: "a font stack that supports both Latin and Arabic
 * scripts, e.g. Cairo + Inter").
 *
 * `next/font` self-hosts the files at build time and emits them from our own
 * origin, so no request reaches a third-party font CDN at runtime and the
 * `font-src 'self' data:` CSP directive needs no relaxation. `display: swap`
 * means text is painted in the fallback immediately, which keeps the font from
 * contributing to layout shift (Gate M2 requires CLS < 0.1).
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  fallback: ['system-ui', 'sans-serif'],
})

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  display: 'swap',
  variable: '--font-arabic',
  fallback: ['system-ui', 'sans-serif'],
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

/**
 * The public site is rendered per request, never prerendered at build time.
 *
 * Every page below this layout reads live venue, CMS and court data. Doc 22
 * M2-T07 is explicit that a court created in the admin dashboard must appear
 * immediately with "no static generation", and M2-T08's acceptance criterion is
 * that a CMS edit shows up on the public site after a refresh. Prerendering
 * would bake the state of the database at build time into the HTML and neither
 * would hold.
 *
 * Declaring it on the LAYOUT rather than on each page is deliberate: a
 * page-level `dynamic` export does not override a parent segment that Next has
 * decided is statically generable, so a new page added later would silently be
 * prerendered. This makes the whole subtree dynamic by construction.
 *
 * Freshness is still not a per-request database round trip for everything: the
 * CMS, venue, courts and pricing services cache their queries for 60 seconds
 * behind tags that every admin mutation invalidates (Doc 22 §10.4).
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  if (!isLocale(params.locale)) return {}

  const t = await getTranslations({ locale: params.locale, namespace: 'metadata' })
  const settings = await cms.getSettings(venueConfig.id, [
    'venue.name',
    'seo.default_title',
    'seo.default_description',
  ])

  const siteName = settings['venue.name'] ?? t('defaultTitle')
  const title = settings['seo.default_title'] ?? siteName

  return {
    title: { default: title, template: `%s · ${siteName}` },
    description: settings['seo.default_description'] ?? t('defaultDescription'),
    // Indexing stays off until Milestone 6 completes the launch checklist —
    // a staging deployment must not be indexed (Doc 22 M6).
    robots: { index: false, follow: false },
    alternates: {
      languages: Object.fromEntries(LOCALES.map((locale) => [locale, `/${locale}`])),
    },
  }
}

export default async function PublicLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  if (!isLocale(params.locale)) notFound()
  const locale = params.locale as Locale

  // Makes the locale available to every `getTranslations()` call below this
  // point, including inside nested server components.
  setRequestLocale(locale)

  const [messages, t, settings, socialLinks, venue] = await Promise.all([
    getMessages({ locale }),
    getTranslations({ locale }),
    cms.getSettings(venueConfig.id, [
      'venue.name',
      'venue.tagline',
      'venue.phone',
      'venue.email',
      'venue.address',
      'venue.whatsapp',
    ]),
    cms.getSocialLinks(venueConfig.id, true),
    venueService.getVenueProfile(venueConfig.id),
  ])

  // Order of preference: the CMS override, then the venue row, then the
  // translated product name. Never a hardcoded English string in JSX.
  const venueName = settings['venue.name'] ?? venue?.name ?? t('common.siteName')

  return (
    <html
      lang={locale}
      dir={directionFor(locale)}
      className={`${inter.variable} ${cairo.variable}`}
    >
      <body className="flex min-h-screen flex-col bg-canvas font-sans text-body text-ink-900 antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/*
            First focusable element on the page. A keyboard user reaches the
            content without tabbing the whole navigation on every page
            (Doc 03 NFR-ACC-002).
          */}
          <a href="#main-content" className="skip-link">
            {t('nav.skipToContent')}
          </a>

          <SiteHeader venueName={venueName} />

          <main id="main-content" className="flex-1">
            {children}
          </main>

          <SiteFooter
            venueName={venueName}
            tagline={settings['venue.tagline'] ?? null}
            contact={{
              phone: settings['venue.phone'] ?? null,
              email: settings['venue.email'] ?? null,
              address: settings['venue.address'] ?? null,
            }}
            socialLinks={socialLinks}
          />

          <WhatsAppButton number={settings['venue.whatsapp'] ?? null} label={t('nav.whatsapp')} />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
