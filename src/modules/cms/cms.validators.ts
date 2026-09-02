import { z } from 'zod'
import { cmsSettingDefinition, CMS_GROUPS, type CmsValueType } from './cms.keys'
import { SOCIAL_PLATFORMS } from './cms.types'

/**
 * CMS input validation (Doc 09 §7, Doc 22 M2-T02).
 *
 * Every rule here comes from Doc 09 §7's validation table. Nothing invents a
 * business constraint: the formats below describe how a value must be WRITTEN,
 * never what it must BE. An empty value is always accepted — clearing a field
 * is how the owner marks something as not yet decided, and Doc 22 §10.5 makes
 * every consumer handle absence gracefully.
 */

/** Doc 09 §7 — Egyptian mobile: 01 followed by 9 digits. */
const EGYPTIAN_MOBILE = /^01\d{9}$/

/** Doc 09 §7 — international format for WhatsApp: +20 followed by digits. */
const INTERNATIONAL_EGYPT = /^\+20\d{8,12}$/

const MAX_TEXT = 500
const MAX_LONG_TEXT = 5000

/** An unset value. Written as NULL so `getSetting` reports absence, not "". */
export const EMPTY = ''

function optionalText(max: number) {
  return z.string().trim().max(max, `Must be ${max} characters or fewer.`)
}

/**
 * Per-value-type validation.
 *
 * `phone` is used by both `venue.phone` and `venue.instapay_number`; the
 * InstaPay number is the one that reaches a customer's payment app, so a
 * malformed value there is a real financial risk rather than a cosmetic one.
 */
const VALIDATOR_BY_TYPE: Record<CmsValueType, z.ZodType<string>> = {
  text: optionalText(MAX_TEXT),
  textarea: optionalText(MAX_LONG_TEXT),
  markdown: optionalText(MAX_LONG_TEXT),
  image: optionalText(MAX_TEXT),
  url: optionalText(MAX_TEXT).refine(
    (value) => value === EMPTY || /^https:\/\/\S+$/.test(value),
    'Must be an HTTPS URL.',
  ),
  email: optionalText(MAX_TEXT).refine(
    (value) => value === EMPTY || z.string().email().safeParse(value).success,
    'Must be a valid email address.',
  ),
  phone: optionalText(MAX_TEXT),
}

/**
 * Validate one setting value against its key's rules.
 *
 * Returns the normalised value, or a message. Keys outside the catalogue are
 * rejected: the settings table is a fixed schema, not a free-form store, so an
 * unexpected key means either a bug or an attempt to write somewhere unintended.
 */
export function validateSettingValue(
  key: string,
  rawValue: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const definition = cmsSettingDefinition(key)
  if (!definition) return { ok: false, message: 'Unknown setting.' }

  const parsed = VALIDATOR_BY_TYPE[definition.valueType].safeParse(rawValue)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid value.' }
  }

  const value = parsed.data
  if (value === EMPTY) return { ok: true, value }

  // Key-specific rules from Doc 09 §7.
  if (key === 'venue.whatsapp' && !INTERNATIONAL_EGYPT.test(value)) {
    return { ok: false, message: 'Use international format, for example +201012345678.' }
  }
  if ((key === 'venue.instapay_number' || key === 'venue.phone') && !EGYPTIAN_MOBILE.test(value)) {
    return { ok: false, message: 'Use an Egyptian mobile number, for example 01012345678.' }
  }

  return { ok: true, value }
}

/** Body of `PUT /api/v1/admin/cms/settings` — one tab group at a time. */
export const updateSettingsSchema = z.object({
  group: z.enum(CMS_GROUPS),
  settings: z.record(z.string().max(100), z.string().max(MAX_LONG_TEXT)),
})

// ── Collections (Doc 09 §7) ──────────────────────────────────────────────────

export const faqInputSchema = z.object({
  question: z
    .string()
    .trim()
    .min(5, 'Question must be at least 5 characters.')
    .max(500, 'Question must be 500 characters or fewer.'),
  answer: z
    .string()
    .trim()
    .min(10, 'Answer must be at least 10 characters.')
    .max(5000, 'Answer must be 5000 characters or fewer.'),
  isPublished: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(9999).optional(),
})

export const reorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1).max(200),
})

export const galleryItemInputSchema = z.object({
  caption: z.string().trim().max(500).optional(),
  category: z.string().trim().max(100).optional(),
  isPublished: z.boolean().default(true),
})

export const eventInputSchema = z.object({
  title: z.string().trim().min(2).max(255),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens.')
    .max(255)
    .optional(),
  description: z.string().trim().max(5000).optional(),
  // Doc 09 §7: past events are allowed, so no future-date constraint.
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.')
    .optional(),
  eventTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, for example 19:00.')
    .optional(),
  isPublished: z.boolean().default(false),
})

export const announcementInputSchema = z
  .object({
    title: z.string().trim().min(2).max(255),
    body: z.string().trim().min(2).max(5000),
    /** Doc 09 §7 — must be in the future when provided. */
    expiresAt: z.string().datetime({ offset: true }).optional(),
    isPublished: z.boolean().default(false),
  })
  .refine((input) => !input.expiresAt || new Date(input.expiresAt).getTime() > Date.now(), {
    path: ['expiresAt'],
    message: 'Expiry must be in the future.',
  })

export const socialLinkInputSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  /** Doc 09 §7 — HTTPS only. An http:// profile link would be downgraded anyway. */
  url: z
    .string()
    .trim()
    .max(500)
    .refine((value) => value === EMPTY || /^https:\/\/\S+$/.test(value), 'Must be an HTTPS URL.'),
  isActive: z.boolean().default(true),
})

export type FaqInput = z.infer<typeof faqInputSchema>
export type GalleryItemInput = z.infer<typeof galleryItemInputSchema>
export type EventInput = z.infer<typeof eventInputSchema>
export type AnnouncementInput = z.infer<typeof announcementInputSchema>
export type SocialLinkInput = z.infer<typeof socialLinkInputSchema>
