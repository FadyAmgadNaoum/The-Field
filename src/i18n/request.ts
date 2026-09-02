import { getRequestConfig } from 'next-intl/server'
import type { AbstractIntlMessages } from 'next-intl'
import { DEFAULT_LOCALE, isLocale, type Locale } from './config'

/**
 * next-intl request configuration (Doc 24 §C.3).
 *
 * Wired into the build by `createNextIntlPlugin` in next.config.mjs. Called
 * once per request to supply the message catalogue for the resolved locale.
 *
 * Messages are imported statically per locale so the bundler can code-split
 * them; a dynamic path built from the locale string would defeat that and
 * would also accept an arbitrary value as a filesystem path.
 */
const loaders: Record<Locale, () => Promise<{ default: AbstractIntlMessages }>> = {
  en: () => import('../../messages/en.json'),
  ar: () => import('../../messages/ar.json'),
}

export default getRequestConfig(async ({ requestLocale }) => {
  // `requestLocale` replaces the deprecated `locale` parameter (next-intl 3.22).
  // It is a promise because the locale may come from the route segment, which
  // is only known once the request is being rendered.
  const requested = await requestLocale

  // Routes outside the `[locale]` segment (the admin dashboard, API handlers)
  // resolve to the default rather than failing — Doc 23 REL-M2-T01 keeps the
  // admin UI English-only.
  const resolved = isLocale(requested) ? requested : DEFAULT_LOCALE

  return {
    locale: resolved,
    messages: (await loaders[resolved]()).default,
    // The venue operates in exactly one timezone (Doc 24 §D.2). Pinning it here
    // means a formatted date is the venue's business date on every device,
    // regardless of where the visitor's browser thinks it is.
    timeZone: 'Africa/Cairo',
  }
})
