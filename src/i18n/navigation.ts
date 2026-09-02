import { createSharedPathnamesNavigation } from 'next-intl/navigation'
import { LOCALES } from './config'

/**
 * Locale-aware navigation primitives (Doc 23 REL-M2-T01).
 *
 * `Link`, `redirect`, `usePathname` and `useRouter` from here automatically
 * carry the active locale prefix. Components import these instead of the
 * `next/link` and `next/navigation` originals so no call site has to build
 * `/${locale}/courts` by hand — a pattern that reliably drifts.
 *
 * The admin dashboard is not localised and continues to use `next/link`.
 */
export const { Link, redirect, usePathname, useRouter, permanentRedirect } =
  createSharedPathnamesNavigation({
    locales: LOCALES,
    // Doc 23 REL-M2-T01: the locale is always in the URL, for SEO and so a
    // shared link opens in the language it was shared in.
    localePrefix: 'always',
  })
