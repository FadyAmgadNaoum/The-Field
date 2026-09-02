import { describe, expect, it } from 'vitest'
import {
  formatBusinessDate,
  formatDayList,
  formatMoney,
  formatTimeRange,
  formatWallClockTime,
  formatWeekday,
} from '@/lib/ui/format'

/**
 * Display formatting (Doc 22 §8.1, Doc 24 §D.2, Doc 23 REL-M2-T01).
 *
 * The property under test throughout is that a venue-local wall-clock value
 * survives formatting unchanged. `booking_date` and `start_time` are not
 * instants; treating them as such produces the classic off-by-one where a
 * customer west of Cairo sees yesterday's date on their own booking.
 */

describe('formatBusinessDate', () => {
  it('renders the date that was given, with no timezone shift', () => {
    // If this were parsed as an instant and rendered in a negative-offset zone,
    // the day number would come out as 9.
    expect(formatBusinessDate('en', '2026-09-10')).toContain('10')
    expect(formatBusinessDate('en', '2026-09-10')).toContain('2026')
  })

  it('is stable at both ends of the year', () => {
    expect(formatBusinessDate('en', '2026-01-01')).toContain('2026')
    expect(formatBusinessDate('en', '2026-12-31')).toContain('31')
  })

  it('renders Arabic with Arabic-Indic numerals', () => {
    // Doc 23 REL-M2-T01 asks for Arabic-Indic numerals in Arabic mode. They
    // fall out of passing the locale to Intl rather than a substitution table.
    const arabic = formatBusinessDate('ar', '2026-09-10')
    expect(arabic).toMatch(/[٠-٩]/)
  })

  it('returns a malformed value unchanged rather than throwing', () => {
    // A render must never fail because a column held something unexpected.
    expect(formatBusinessDate('en', 'not-a-date')).toBe('not-a-date')
    expect(formatBusinessDate('en', '2026-13-45')).toBe('2026-13-45')
  })
})

describe('formatWallClockTime', () => {
  it('formats a TIME column value', () => {
    expect(formatWallClockTime('en', '19:00:00')).toMatch(/7|19/)
  })

  it('renders 24:00 literally', () => {
    // Doc 24 §F.4: 24:00 is a valid closing boundary. Intl cannot represent it,
    // and wrapping it to 00:00 would make the last slot of the night look like
    // the first slot of the morning.
    expect(formatWallClockTime('en', '24:00:00')).toBe('24:00')
    expect(formatWallClockTime('ar', '24:00')).toBe('24:00')
  })

  it('returns a malformed value unchanged', () => {
    expect(formatWallClockTime('en', 'nonsense')).toBe('nonsense')
  })
})

describe('formatTimeRange', () => {
  it('joins both ends of the slot', () => {
    const range = formatTimeRange('en', '23:00:00', '24:00:00')
    expect(range).toContain('24:00')
    expect(range).toContain('–')
  })
})

describe('formatWeekday', () => {
  it('maps 0 to Sunday and 6 to Saturday', () => {
    // The mapping must match operating_hours.day_of_week and
    // court_pricing_rules.applicable_days (Doc 05 §4.3, §4.4). Getting this
    // wrong would publish the venue's hours on the wrong days.
    expect(formatWeekday('en', 0)).toBe('Sunday')
    expect(formatWeekday('en', 6)).toBe('Saturday')
  })

  it('covers every day exactly once', () => {
    const names = new Set([0, 1, 2, 3, 4, 5, 6].map((day) => formatWeekday('en', day)))
    expect(names.size).toBe(7)
  })

  it('localises to Arabic', () => {
    expect(formatWeekday('ar', 0)).not.toBe('Sunday')
    expect(formatWeekday('ar', 0)).toMatch(/[؀-ۿ]/)
  })
})

describe('formatDayList', () => {
  it('collapses a full week to the supplied label', () => {
    expect(formatDayList('en', [0, 1, 2, 3, 4, 5, 6], 'Every day')).toBe('Every day')
  })

  it('lists a partial week', () => {
    const result = formatDayList('en', [4, 5, 6], 'Every day')
    expect(result).not.toBe('Every day')
    expect(result.length).toBeGreaterThan(0)
  })

  it('de-duplicates and sorts', () => {
    expect(formatDayList('en', [6, 4, 4, 5, 6], 'Every day')).toBe(
      formatDayList('en', [4, 5, 6], 'Every day'),
    )
  })

  it('returns an empty string for no days', () => {
    expect(formatDayList('en', [], 'Every day')).toBe('')
  })
})

describe('formatMoney', () => {
  it('formats a decimal string held as stored', () => {
    const result = formatMoney('en', '350.00', 'EGP')
    expect(result).toContain('350')
  })

  it('preserves two decimal places where they are significant', () => {
    expect(formatMoney('en', '350.50', 'EGP')).toContain('350.5')
  })

  it('falls back rather than throwing on an unknown currency code', () => {
    // A bad currency code must not take down the pricing page.
    expect(formatMoney('en', '350.00', 'ZZZZ')).toBe('350.00 ZZZZ')
  })

  it('falls back rather than throwing on a non-numeric amount', () => {
    expect(formatMoney('en', 'abc', 'EGP')).toBe('abc EGP')
  })
})
