/**
 * Locale-aware display formatting (Doc 23 REL-M2-T01, Doc 22 §8.1).
 *
 * ── THE TIMEZONE RULE ────────────────────────────────────────────────────────
 * `booking_date` is a DATE and `start_time`/`end_time` are TIME columns holding
 * venue-local wall-clock values (Doc 24 §D.2). They are not instants and must
 * never be treated as such.
 *
 * Formatting '2026-09-10' by constructing `new Date('2026-09-10')` and letting
 * the browser apply its own zone is the classic off-by-one: a viewer in UTC-5
 * sees the 9th. Every function here builds the date at UTC midnight and formats
 * it in UTC, so the digits that come out are exactly the digits that went in,
 * on every device in every timezone.
 *
 * Arabic renders with Arabic-Indic numerals, as Doc 23 REL-M2-T01 requires.
 * That does not come free from the locale string — see `intlLocale` below.
 */

/** Reference week beginning on a Sunday, so index 0 is Sunday (Doc 05 §4.4). */
const SUNDAY_UTC = Date.UTC(2024, 0, 7)

/**
 * Resolve an application locale to the tag `Intl` should actually use.
 *
 * Doc 23 REL-M2-T01 requires Arabic-Indic numerals (٠١٢٣) for Arabic users.
 * A bare `ar` does NOT produce them — CLDR's region-neutral Arabic resolves to
 * Latin digits, so `formatBusinessDate('ar', …)` renders "10 سبتمبر" rather
 * than "١٠ سبتمبر". Requesting the `arab` numbering system explicitly through
 * the Unicode extension makes the outcome independent of the ICU build the
 * application happens to be running on, which matters because the development
 * machine and the production VPS need not agree.
 *
 * The region is Egypt, which is where the venue operates (Doc 01 A4).
 */
const INTL_LOCALES: Record<string, string> = {
  ar: 'ar-EG-u-nu-arab',
}

function intlLocale(locale: string): string {
  return INTL_LOCALES[locale] ?? locale
}

/**
 * Weekday name for a `day_of_week` column value.
 *
 * 0 = Sunday … 6 = Saturday, matching `operating_hours.day_of_week` and
 * `court_pricing_rules.applicable_days` (Doc 05 §4.3, §4.4).
 */
export function formatWeekday(locale: string, dayOfWeek: number, style: 'long' | 'short' = 'long') {
  const date = new Date(SUNDAY_UTC + dayOfWeek * 24 * 60 * 60 * 1000)
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: style, timeZone: 'UTC' }).format(
    date,
  )
}

/**
 * Format a 'YYYY-MM-DD' business date.
 *
 * Returns the input unchanged if it is not in that shape, so a malformed value
 * from the database is displayed rather than throwing during render.
 */
export function formatBusinessDate(locale: string, isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate

  const date = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return isoDate

  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/**
 * Format an 'HH:MM' or 'HH:MM:SS' wall-clock time.
 *
 * '24:00' is a valid closing boundary (Doc 24 §F.4) and is not a time `Intl`
 * can represent, so it is rendered literally rather than wrapping to 00:00 and
 * appearing to be the start of the day.
 */
export function formatWallClockTime(locale: string, time: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(time)
  if (!match) return time

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours === 24) return '24:00'
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return time

  const date = new Date(Date.UTC(2024, 0, 1, hours, minutes))
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date)
}

export function formatTimeRange(locale: string, start: string, end: string): string {
  return `${formatWallClockTime(locale, start)} – ${formatWallClockTime(locale, end)}`
}

/**
 * Format a money amount held as a decimal string.
 *
 * The value stays a string until this point. `numeric(10,2)` is exact and
 * parsing it to a JavaScript number earlier would introduce a float that could
 * round — acceptable for display, never for the stored figure
 * (Doc 03 NFR-DATA-003).
 */
export function formatMoney(locale: string, amount: string, currency: string): string {
  const value = Number(amount)
  if (!Number.isFinite(value)) return `${amount} ${currency}`

  try {
    return new Intl.NumberFormat(intlLocale(locale), {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    // An unrecognised currency code must not break a page.
    return `${amount} ${currency}`
  }
}

/**
 * Compress a sorted day list into a readable phrase.
 *
 * A pricing rule that applies every day reads better as "Every day" than as
 * seven weekday names on a 390px screen.
 */
export function formatDayList(
  locale: string,
  days: readonly number[],
  allDaysLabel: string,
): string {
  const unique = [...new Set(days)].sort((a, b) => a - b)
  if (unique.length === 0) return ''
  if (unique.length === 7) return allDaysLabel

  const names = unique.map((day) => formatWeekday(locale, day, 'short'))

  try {
    return new Intl.ListFormat(intlLocale(locale), { style: 'short', type: 'conjunction' }).format(
      names,
    )
  } catch {
    return names.join(', ')
  }
}
