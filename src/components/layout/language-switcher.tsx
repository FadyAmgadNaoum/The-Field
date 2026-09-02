'use client'

import { useId } from 'react'
import { Globe } from 'lucide-react'
import { useLocale } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { buttonStyles } from '@/components/ui/button'
import { LOCALE_LABELS, LOCALES, toLocale, type Locale } from '@/i18n/config'
import { cn } from '@/lib/ui/cn'

/**
 * Language switcher (Doc 23 REL-M2-T01, Gate M2).
 *
 * ── WHY LINKS AND NOT A SELECT ───────────────────────────────────────────────
 * Each language is a real URL, so switching is an ordinary navigation: it works
 * without JavaScript, the choice is shareable and bookmarkable, and search
 * engines index both versions. A `<select>` with an onChange handler would give
 * up all of that.
 *
 * `usePathname` from `@/i18n/navigation` returns the path WITHOUT the locale
 * prefix, so linking to the same path under another locale is exact — the
 * customer stays on the page they were reading rather than being sent home.
 *
 * Persistence: next-intl's middleware writes the chosen locale to a cookie on
 * navigation, so the preference survives to the next visit. Doc 23 REL-M2-T01
 * suggests localStorage; a cookie is the server-readable equivalent and is what
 * lets the very first render of a later visit already be in the right language.
 *
 * Each target locale's name is written in its own script, which is the one
 * label a reader who cannot read the current language will still recognise —
 * so the element also carries `lang` for correct pronunciation.
 */
export function LanguageSwitcher({ label }: { label: string }) {
  const active = toLocale(useLocale())
  const pathname = usePathname()

  /*
   * The header renders this component twice — once in the desktop bar and once
   * inside the mobile menu panel — so a hardcoded id would appear twice in the
   * document. Duplicate ids silently break `aria-labelledby`: the browser
   * resolves the FIRST match, which for the mobile instance is the hidden
   * desktop label. `useId` gives each instance its own.
   */
  const labelId = `language-switcher-${useId()}`

  return (
    <div className="flex items-center gap-1">
      <Globe aria-hidden className="h-4 w-4 shrink-0 text-ink-500" />
      <span className="sr-only" id={labelId}>
        {label}
      </span>
      <ul aria-labelledby={labelId} className="flex items-center gap-1">
        {LOCALES.map((locale: Locale) => {
          const isActive = locale === active
          return (
            <li key={locale}>
              <Link
                href={pathname}
                locale={locale}
                lang={locale}
                hrefLang={locale}
                // `aria-current` conveys the selected language without relying
                // on the colour difference alone.
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  buttonStyles({ variant: 'ghost', size: 'sm' }),
                  'px-2.5',
                  isActive && 'bg-ink-100 font-semibold text-ink-900',
                )}
              >
                {LOCALE_LABELS[locale]}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
