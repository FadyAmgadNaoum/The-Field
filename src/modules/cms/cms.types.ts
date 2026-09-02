/**
 * CMS content types (Doc 09 §10).
 *
 * These are the shapes the service returns — not the raw table rows. Derived
 * fields such as `imageUrl` are resolved at the service layer from the storage
 * key, so no page ever has to know how a key becomes a URL (Doc 09 §10).
 */

export interface CmsSettingValue {
  key: string
  value: string | null
}

/** Group values, keyed by full setting key. Missing keys are absent, not empty. */
export type CmsSettingMap = Record<string, string | null>

export interface Faq {
  id: string
  question: string
  answer: string
  displayOrder: number
  isPublished: boolean
}

export interface GalleryItem {
  id: string
  storageKey: string
  /** Derived from the storage key. Null when storage is not configured. */
  imageUrl: string | null
  caption: string | null
  category: string | null
  displayOrder: number
  isPublished: boolean
}

export interface CmsEventItem {
  id: string
  title: string
  slug: string | null
  description: string | null
  /** 'YYYY-MM-DD' — a venue-local business date, never a Date object. */
  eventDate: string | null
  eventTime: string | null
  coverImageUrl: string | null
  isPublished: boolean
}

export interface Announcement {
  id: string
  title: string
  body: string
  expiresAt: Date | null
  isPublished: boolean
}

export interface SocialLink {
  id: string
  platform: string
  url: string
  displayOrder: number
  isActive: boolean
}

/** Doc 09 §6.6 — the platforms the editor offers. */
export const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube', 'twitter'] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  twitter: 'X (Twitter)',
}

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(value)
}
