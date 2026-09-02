import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonStyles } from '@/components/ui/button'
import { Container } from '@/components/ui/layout'
import { BOOKING_CTA_HREF, PRIMARY_NAV } from './nav-items'
import { LanguageSwitcher } from './language-switcher'
import { MobileNav } from './mobile-nav'

/**
 * Public site header (Doc 22 M2-T04).
 *
 * A server component: the only interactive parts are the mobile menu and the
 * language switcher, and each is its own small client island. The navigation
 * links themselves ship as plain HTML, so the header works before hydration and
 * costs almost nothing in JavaScript (Doc 03 NFR-PERF).
 *
 * `relative` on the element is load-bearing — the mobile panel positions itself
 * against this header, not against the viewport, which is what keeps it in flow
 * and free of horizontal overflow at 390px.
 */
export async function SiteHeader({ venueName }: { venueName: string }) {
  const t = await getTranslations()

  const links = PRIMARY_NAV.map((item) => ({ href: item.href, label: t(item.labelKey) }))

  return (
    <header className="relative border-b border-line bg-canvas">
      <Container className="flex min-h-touch items-center justify-between gap-3 py-3">
        {/*
          The venue name is the home link. FR-CUS-004 requires the venue's name
          on every page; no logo asset has been supplied by the owner, so the
          name is set as type rather than inventing a mark.
        */}
        <Link
          href="/"
          className="inline-flex min-h-touch shrink-0 items-center rounded-control px-1 text-heading-sm font-semibold tracking-tight text-ink-900 transition-colors duration-200 hover:text-brand-800"
        >
          {venueName}
        </Link>

        <nav aria-label={t('nav.primaryLabel')} className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex min-h-touch items-center rounded-control px-3 text-body-sm font-medium text-ink-700 transition-colors duration-200 hover:bg-brand-50 hover:text-brand-800"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden lg:block">
            <LanguageSwitcher label={t('nav.languageLabel')} />
          </div>

          <Link
            href="/booking-status"
            className="hidden lg:flex lg:min-h-touch lg:items-center lg:rounded-control lg:px-3 lg:text-body-sm lg:font-medium lg:text-ink-700 lg:hover:bg-ink-50"
          >
            {t('nav.bookingStatus')}
          </Link>

          <Link href={BOOKING_CTA_HREF} className={buttonStyles({ size: 'sm' })}>
            {t('nav.bookNow')}
          </Link>

          <MobileNav
            links={[
              ...links,
              { href: '/booking-status', label: t('nav.bookingStatus') },
              { href: '/signin', label: t('nav.signIn') },
            ]}
            ctaHref={BOOKING_CTA_HREF}
            ctaLabel={t('nav.bookNow')}
            openLabel={t('nav.openMenu')}
            closeLabel={t('nav.closeMenu')}
            menuLabel={t('nav.menuLabel')}
            languageSwitcher={<LanguageSwitcher label={t('nav.languageLabel')} />}
          />
        </div>
      </Container>
    </header>
  )
}
