/**
 * The CMS settings catalogue (Doc 09 §3.1, Doc 22 §10.1–10.2).
 *
 * `cms_site_settings` is a key-value table and starts EMPTY — Doc 24 §D.4
 * forbids seeding business values. This module is the schema for that table:
 * which keys exist, which tab they belong to, how the admin form should render
 * them, and how they are validated.
 *
 * ── WHY A CODE CATALOGUE AND NOT SEED ROWS ───────────────────────────────────
 * Seeding rows with empty values would put invented structure into production
 * data and would mean a new key requires a migration. Keeping the catalogue in
 * code means the admin editor always shows every field, a row is written only
 * when the owner actually enters a value, and `getSetting` returns null for
 * anything unset — which is exactly what the graceful-degradation rules in
 * Doc 22 §10.5 expect.
 *
 * NO KEY HAS A DEFAULT VALUE. Every entry in the table below is a business
 * value that only the venue owner can supply (Doc 22 §10.2, Doc 24 §M item 11).
 */

export const CMS_GROUPS = ['general', 'contact', 'payment', 'homepage', 'about', 'seo'] as const
export type CmsGroup = (typeof CMS_GROUPS)[number]

/** Maps to the admin form control (Doc 09 §6.1). */
export type CmsValueType = 'text' | 'textarea' | 'markdown' | 'image' | 'url' | 'email' | 'phone'

export interface CmsSettingDefinition {
  key: string
  group: CmsGroup
  valueType: CmsValueType
  /** Field label in the admin editor. English only — the admin UI is not localised. */
  label: string
  /** Shown under the field. Says what the value is used for and where it appears. */
  help?: string
}

export const CMS_SETTINGS: readonly CmsSettingDefinition[] = [
  // ── general ───────────────────────────────────────────────────────────────
  {
    key: 'venue.name',
    group: 'general',
    valueType: 'text',
    label: 'Venue name',
    help: 'Shown in the header, footer and page titles. Falls back to "The Field" if empty.',
  },
  {
    key: 'venue.tagline',
    group: 'general',
    valueType: 'text',
    label: 'Tagline',
    help: 'Short line shown under the venue name in the footer.',
  },

  // ── contact ───────────────────────────────────────────────────────────────
  {
    key: 'venue.phone',
    group: 'contact',
    valueType: 'phone',
    label: 'Public phone number',
    help: 'Shown on the contact page. Egyptian mobile format, for example 01012345678.',
  },
  {
    key: 'venue.whatsapp',
    group: 'contact',
    valueType: 'text',
    label: 'WhatsApp number',
    help: 'International format starting +20. The floating WhatsApp button is hidden while this is empty.',
  },
  {
    key: 'venue.email',
    group: 'contact',
    valueType: 'email',
    label: 'Contact email',
    help: 'Shown on the contact page.',
  },
  {
    key: 'venue.address',
    group: 'contact',
    valueType: 'textarea',
    label: 'Address',
    help: 'Shown on the contact page and in the footer.',
  },
  {
    key: 'venue.map_embed_url',
    group: 'contact',
    valueType: 'url',
    label: 'Map link',
    help: 'HTTPS link to the venue location on a map. Rendered as an "Open in Maps" link, not an embedded frame.',
  },

  // ── payment ───────────────────────────────────────────────────────────────
  {
    key: 'venue.instapay_number',
    group: 'payment',
    valueType: 'phone',
    label: 'InstaPay number',
    help:
      'Shown to customers during checkout. While this is empty the payment step shows a notice ' +
      'and booking submission is disabled. Confirm the number with the venue owner before setting it.',
  },
  {
    key: 'venue.instapay_account_name',
    group: 'payment',
    valueType: 'text',
    label: 'InstaPay account name',
    help: 'The name the customer should see on the transfer.',
  },
  {
    key: 'venue.instapay_instructions',
    group: 'payment',
    valueType: 'textarea',
    label: 'Payment instructions',
    help: 'Free text shown with the InstaPay number at checkout.',
  },

  // ── homepage ──────────────────────────────────────────────────────────────
  {
    key: 'homepage.hero_headline',
    group: 'homepage',
    valueType: 'text',
    label: 'Hero headline',
    help: 'Main heading on the home page. A neutral default is shown while empty.',
  },
  {
    key: 'homepage.hero_subtitle',
    group: 'homepage',
    valueType: 'textarea',
    label: 'Hero subtitle',
  },
  {
    key: 'homepage.hero_cta_label',
    group: 'homepage',
    valueType: 'text',
    label: 'Hero button label',
  },
  {
    key: 'homepage.hero_image_key',
    group: 'homepage',
    valueType: 'image',
    label: 'Hero background image',
    help: 'Optional. A plain background is used while empty.',
  },

  // ── about ─────────────────────────────────────────────────────────────────
  {
    key: 'about.headline',
    group: 'about',
    valueType: 'text',
    label: 'About headline',
  },
  {
    key: 'about.body',
    group: 'about',
    valueType: 'markdown',
    label: 'About body',
    help: 'Rich text. Only paragraphs, headings, lists, bold, italic and links are kept — everything else is removed on save.',
  },

  // ── seo ───────────────────────────────────────────────────────────────────
  {
    key: 'seo.default_title',
    group: 'seo',
    valueType: 'text',
    label: 'Default page title',
  },
  {
    key: 'seo.default_description',
    group: 'seo',
    valueType: 'textarea',
    label: 'Default meta description',
  },
  {
    key: 'seo.og_image_key',
    group: 'seo',
    valueType: 'image',
    label: 'Social share image',
  },
] as const

const BY_KEY = new Map(CMS_SETTINGS.map((definition) => [definition.key, definition]))

export function cmsSettingDefinition(key: string): CmsSettingDefinition | undefined {
  return BY_KEY.get(key)
}

export function isCmsSettingKey(key: string): boolean {
  return BY_KEY.has(key)
}

export function cmsSettingsInGroup(group: CmsGroup): readonly CmsSettingDefinition[] {
  return CMS_SETTINGS.filter((definition) => definition.group === group)
}

export function isCmsGroup(value: unknown): value is CmsGroup {
  return typeof value === 'string' && (CMS_GROUPS as readonly string[]).includes(value)
}

/** Keys whose value is a storage key rather than display text. */
export const CMS_IMAGE_KEYS = CMS_SETTINGS.filter((d) => d.valueType === 'image').map((d) => d.key)
