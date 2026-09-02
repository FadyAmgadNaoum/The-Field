/**
 * Locale configuration (Doc 24 §C.3, Doc 23 REL-M2-T01).
 *
 * OBD-003 is RESOLVED: the customer-facing site is bilingual Arabic + English
 * with full RTL. The administrator dashboard is English-only in V1 — its
 * audience is venue staff and an Arabic admin UI is a documented future
 * enhancement, not a V1 requirement.
 *
 * This module is imported by middleware (Edge runtime), server components and
 * client components alike, so it must stay free of Node-only imports.
 */

export const LOCALES = ['en', 'ar'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

/** Text direction per locale. Applied to <html dir>. */
const DIRECTIONS: Record<Locale, 'ltr' | 'rtl'> = {
  en: 'ltr',
  ar: 'rtl',
}

/** Endonyms — a language is always offered in its own script. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ar: 'العربية',
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

export function directionFor(locale: Locale): 'ltr' | 'rtl' {
  return DIRECTIONS[locale]
}

/**
 * Narrow an untrusted value to a supported locale.
 *
 * Used wherever a locale arrives from outside the type system — a route
 * segment, a header, a form field. Anything unrecognised falls back rather
 * than throwing, so a hand-typed URL cannot produce a 500.
 */
export function toLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE
}

/** Header set by src/middleware.ts so the root layout can resolve `lang`/`dir`. */
export const LOCALE_HEADER = 'x-app-locale'
