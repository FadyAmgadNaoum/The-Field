import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import ar from '../../../messages/ar.json'
import { DEFAULT_LOCALE, LOCALES, directionFor, isLocale, toLocale } from '@/i18n/config'

/**
 * Message catalogue integrity (Doc 23 REL-M2-T01, Gate M2).
 *
 * Gate M2 requires that no untranslated English string is visible in Arabic
 * mode. A missing key does not throw at build time — next-intl falls back and
 * renders the key path or the default-locale string, so the failure only shows
 * up as English text on an Arabic page, in whichever component nobody happened
 * to look at. These tests turn that into a build failure instead.
 */

type Json = Record<string, unknown>

function flatten(source: Json, prefix = ''): Record<string, string> {
  const output: Record<string, string> = {}

  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(output, flatten(value as Json, path))
    } else {
      output[path] = String(value)
    }
  }
  return output
}

const flatEn = flatten(en as Json)
const flatAr = flatten(ar as Json)

/** ICU placeholders such as `{email}`. Both catalogues must use the same set. */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)/g)].map((match) => match[1] as string).sort()
}

describe('locale configuration', () => {
  it('lists exactly the two supported locales', () => {
    expect([...LOCALES]).toEqual(['en', 'ar'])
    expect(DEFAULT_LOCALE).toBe('en')
  })

  it('maps Arabic to RTL and English to LTR', () => {
    // Gate M2 checks for dir="rtl" on the html element in Arabic.
    expect(directionFor('ar')).toBe('rtl')
    expect(directionFor('en')).toBe('ltr')
  })

  it('narrows an untrusted value to a supported locale', () => {
    expect(isLocale('ar')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    // A hand-typed URL segment must fall back, never throw.
    expect(toLocale('fr')).toBe('en')
    expect(toLocale('ar')).toBe('ar')
  })
})

describe('message catalogues', () => {
  it('has no key present in English but missing from Arabic', () => {
    const missing = Object.keys(flatEn).filter((key) => !(key in flatAr))
    expect(missing).toEqual([])
  })

  it('has no key present in Arabic but missing from English', () => {
    // An orphan Arabic key means a string was removed from the UI and the
    // translation was left behind, or a key was misspelled in one file.
    const extra = Object.keys(flatAr).filter((key) => !(key in flatEn))
    expect(extra).toEqual([])
  })

  it('has no empty values in either catalogue', () => {
    const emptyEn = Object.entries(flatEn).filter(([, value]) => value.trim() === '')
    const emptyAr = Object.entries(flatAr).filter(([, value]) => value.trim() === '')
    expect(emptyEn).toEqual([])
    expect(emptyAr).toEqual([])
  })

  it('uses the same ICU placeholders in both languages', () => {
    // A placeholder dropped in translation renders a message with a missing
    // value; one added renders a next-intl error at runtime.
    const mismatched = Object.keys(flatEn).filter((key) => {
      const source = placeholders(flatEn[key] as string)
      const target = placeholders(flatAr[key] as string)
      return source.join(',') !== target.join(',')
    })
    expect(mismatched).toEqual([])
  })

  it('actually contains Arabic script in the Arabic catalogue', () => {
    // Catches a file copied from English and never translated. Values that are
    // deliberately identical across languages (a sample booking reference) are
    // excluded rather than forced into Arabic script.
    const identical = ['bookingStatus.referencePlaceholder']

    const untranslated = Object.keys(flatEn).filter((key) => {
      if (identical.includes(key)) return false
      const value = flatAr[key] as string
      return !/[؀-ۿ]/.test(value)
    })
    expect(untranslated).toEqual([])
  })

  it('covers every booking status the database can hold', () => {
    // The status page indexes into these namespaces with a value straight from
    // the `booking_status` enum. A status with no entry would render a raw
    // enum value like "payment_submitted" to a customer.
    const statuses = [
      'pending',
      'payment_submitted',
      'under_review',
      'approved',
      'rejected',
      'cancelled',
      'expired',
    ]

    for (const status of statuses) {
      expect(flatEn[`bookingStatus.status.${status}`]).toBeTruthy()
      expect(flatAr[`bookingStatus.status.${status}`]).toBeTruthy()
      expect(flatEn[`bookingStatus.statusHelp.${status}`]).toBeTruthy()
      expect(flatAr[`bookingStatus.statusHelp.${status}`]).toBeTruthy()
    }
  })

  it('covers every payment status the database can hold', () => {
    for (const status of ['pending', 'submitted', 'verified', 'rejected']) {
      expect(flatEn[`bookingStatus.payment.${status}`]).toBeTruthy()
      expect(flatAr[`bookingStatus.payment.${status}`]).toBeTruthy()
    }
  })

  it('covers every API error code the browser can receive', () => {
    // The client normalises a failure to its code and looks the message up
    // here. A missing entry surfaces to the customer as a blank error.
    const codes = [
      'VALIDATION_ERROR',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'RATE_LIMITED',
      'SERVICE_UNAVAILABLE',
      'INTERNAL_ERROR',
      'NETWORK',
    ]

    for (const code of codes) {
      expect(flatEn[`errors.${code}`]).toBeTruthy()
      expect(flatAr[`errors.${code}`]).toBeTruthy()
    }
  })
})
