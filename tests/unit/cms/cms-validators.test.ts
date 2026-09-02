import { describe, expect, it } from 'vitest'
import {
  announcementInputSchema,
  faqInputSchema,
  socialLinkInputSchema,
  updateSettingsSchema,
  validateSettingValue,
} from '@/modules/cms/cms.validators'
import { CMS_SETTINGS, cmsSettingDefinition, isCmsSettingKey } from '@/modules/cms/cms.keys'

/**
 * CMS input validation (Doc 09 §7, Doc 22 M2-T02).
 *
 * The InstaPay number is the value with real money behind it: it is what a
 * customer types into their banking app. A malformed one sends a transfer
 * nowhere, so its format check is the most load-bearing rule in this file.
 */

describe('settings catalogue', () => {
  it('recognises only catalogue keys', () => {
    expect(isCmsSettingKey('venue.instapay_number')).toBe(true)
    expect(isCmsSettingKey('venue.not_a_real_key')).toBe(false)
    // The settings table is a fixed schema, not a free-form key-value store.
    expect(isCmsSettingKey('__proto__')).toBe(false)
  })

  it('gives every key a group and a label', () => {
    for (const definition of CMS_SETTINGS) {
      expect(definition.group).toBeTruthy()
      expect(definition.label).toBeTruthy()
    }
  })

  it('has no duplicate keys', () => {
    const keys = CMS_SETTINGS.map((definition) => definition.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('defines no default value for any key', () => {
    // Doc 22 §10.2 / Doc 24 §M item 11: every one of these is a business value
    // only the venue owner can supply. A default here would become a fake
    // phone number or a fake InstaPay account on a live site.
    for (const definition of CMS_SETTINGS) {
      expect(Object.keys(definition)).not.toContain('default')
      expect(Object.keys(definition)).not.toContain('defaultValue')
    }
  })

  it('carries the payment keys the checkout step depends on', () => {
    expect(cmsSettingDefinition('venue.instapay_number')?.group).toBe('payment')
    expect(cmsSettingDefinition('venue.instapay_account_name')?.group).toBe('payment')
  })
})

describe('validateSettingValue', () => {
  it('rejects a key outside the catalogue', () => {
    const result = validateSettingValue('venue.made_up', 'x')
    expect(result.ok).toBe(false)
  })

  it('accepts an empty value for every key', () => {
    // Clearing a field is how the owner marks something as not yet decided.
    for (const definition of CMS_SETTINGS) {
      expect(validateSettingValue(definition.key, '').ok).toBe(true)
    }
  })

  describe('InstaPay number', () => {
    it('accepts a well-formed Egyptian mobile number', () => {
      const result = validateSettingValue('venue.instapay_number', '01012345678')
      expect(result).toEqual({ ok: true, value: '01012345678' })
    })

    it.each([
      ['too short', '0101234567'],
      ['too long', '010123456789'],
      ['wrong prefix', '02012345678'],
      ['contains letters', '0101234567a'],
      ['international format', '+201012345678'],
      ['spaced', '010 1234 5678'],
    ])('rejects a number that is %s', (_reason, value) => {
      const result = validateSettingValue('venue.instapay_number', value)
      expect(result.ok).toBe(false)
    })
  })

  describe('WhatsApp number', () => {
    it('accepts international format', () => {
      expect(validateSettingValue('venue.whatsapp', '+201012345678').ok).toBe(true)
    })

    it('rejects a local-format number', () => {
      // wa.me needs the country code; a local number would produce a dead link.
      expect(validateSettingValue('venue.whatsapp', '01012345678').ok).toBe(false)
    })
  })

  describe('email', () => {
    it('accepts a valid address', () => {
      expect(validateSettingValue('venue.email', 'hello@example.test').ok).toBe(true)
    })

    it('rejects a malformed address', () => {
      expect(validateSettingValue('venue.email', 'not-an-email').ok).toBe(false)
    })
  })

  describe('map link', () => {
    it('accepts an HTTPS URL', () => {
      expect(validateSettingValue('venue.map_embed_url', 'https://maps.example/here').ok).toBe(true)
    })

    it('rejects plain HTTP', () => {
      expect(validateSettingValue('venue.map_embed_url', 'http://maps.example/here').ok).toBe(false)
    })

    it('rejects a javascript: URL', () => {
      // The value ends up in an href; a javascript: scheme there is XSS.
      expect(validateSettingValue('venue.map_embed_url', 'javascript:alert(1)').ok).toBe(false)
    })
  })

  it('trims surrounding whitespace', () => {
    const result = validateSettingValue('venue.name', '  The Field  ')
    expect(result).toEqual({ ok: true, value: 'The Field' })
  })

  it('rejects a value beyond the column length', () => {
    expect(validateSettingValue('venue.name', 'x'.repeat(501)).ok).toBe(false)
  })
})

describe('updateSettingsSchema', () => {
  it('accepts a known group', () => {
    const result = updateSettingsSchema.safeParse({ group: 'payment', settings: {} })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown group', () => {
    const result = updateSettingsSchema.safeParse({ group: 'secrets', settings: {} })
    expect(result.success).toBe(false)
  })
})

describe('faqInputSchema', () => {
  it('accepts a well-formed question', () => {
    const result = faqInputSchema.safeParse({
      question: 'Do you have parking?',
      answer: 'The venue publishes this answer.',
    })
    expect(result.success).toBe(true)
    // Publication defaults to true so a saved FAQ is not silently invisible.
    if (result.success) expect(result.data.isPublished).toBe(true)
  })

  it('rejects a question that is too short', () => {
    const result = faqInputSchema.safeParse({ question: 'Hi', answer: 'A long enough answer.' })
    expect(result.success).toBe(false)
  })

  it('rejects an answer that is too short', () => {
    const result = faqInputSchema.safeParse({ question: 'A real question?', answer: 'no' })
    expect(result.success).toBe(false)
  })
})

describe('announcementInputSchema', () => {
  it('accepts an announcement with no expiry', () => {
    const result = announcementInputSchema.safeParse({ title: 'Closed Friday', body: 'Details.' })
    expect(result.success).toBe(true)
  })

  it('accepts a future expiry', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    const result = announcementInputSchema.safeParse({
      title: 'Closed Friday',
      body: 'Details.',
      expiresAt: future,
    })
    expect(result.success).toBe(true)
  })

  it('rejects an expiry in the past', () => {
    // Doc 09 §7. A past expiry would create an announcement that can never show.
    const past = new Date(Date.now() - 86_400_000).toISOString()
    const result = announcementInputSchema.safeParse({
      title: 'Closed Friday',
      body: 'Details.',
      expiresAt: past,
    })
    expect(result.success).toBe(false)
  })
})

describe('socialLinkInputSchema', () => {
  it('accepts a known platform with an HTTPS URL', () => {
    const result = socialLinkInputSchema.safeParse({
      platform: 'instagram',
      url: 'https://instagram.com/thefield',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown platform', () => {
    const result = socialLinkInputSchema.safeParse({
      platform: 'myspace',
      url: 'https://example.test',
    })
    expect(result.success).toBe(false)
  })

  it('accepts an empty URL, which clears the link', () => {
    const result = socialLinkInputSchema.safeParse({ platform: 'facebook', url: '' })
    expect(result.success).toBe(true)
  })

  it('rejects a non-HTTPS URL', () => {
    const result = socialLinkInputSchema.safeParse({
      platform: 'facebook',
      url: 'javascript:alert(1)',
    })
    expect(result.success).toBe(false)
  })
})
