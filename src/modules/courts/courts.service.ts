import { unstable_cache } from 'next/cache'
import { publicUrlFor } from '@/modules/storage/storage.service'
import * as repo from './courts.repository'

/**
 * Court service — read side (Doc 22 M3-T02, M2-T07).
 *
 * Public pages call `getActiveCourts` and get everything they need to render a
 * card: name, description, features and photo URLs. The storage key never
 * leaves this module — pages receive a resolved URL or null, so no template can
 * accidentally print an internal object key (Doc 12 §3, Doc 24 §M item 3).
 */

export interface CourtImage {
  id: string
  /** Null when storage is not configured — the card then omits the image. */
  url: string | null
  altText: string | null
}

export interface PublicCourt {
  id: string
  name: string
  description: string | null
  courtType: string
  /** Free-form labels supplied by the administrator, e.g. ["covered","lights"]. */
  features: string[]
  images: CourtImage[]
}

export function courtsCacheTag(venueId: string): string {
  return `courts-${venueId}`
}

/**
 * `features` is a free-form `jsonb` column (Doc 05 §4.2) written by the admin
 * court form in Milestone 5. Anything that is not an array of strings is
 * ignored rather than rendered — a malformed value must not break the page.
 */
function toFeatureList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

async function loadActiveCourts(venueId: string): Promise<PublicCourt[]> {
  const rows = await repo.listActiveCourts(venueId)
  if (rows.length === 0) return []

  const images = await repo.listImagesForCourts(rows.map((row) => row.id))

  const byCourt = new Map<string, CourtImage[]>()
  for (const image of images) {
    const list = byCourt.get(image.courtId) ?? []
    list.push({ id: image.id, url: publicUrlFor(image.storageKey), altText: image.altText })
    byCourt.set(image.courtId, list)
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    courtType: row.courtType,
    features: toFeatureList(row.features),
    // An image whose URL could not be resolved is dropped, not rendered broken.
    images: (byCourt.get(row.id) ?? []).filter((image) => image.url !== null),
  }))
}

/**
 * Active courts for the public site.
 *
 * Cached under the courts tag (Doc 22 §10.4). Milestone 5's court editor
 * invalidates that tag on save, which is what makes M2-T07's "a court created
 * in admin appears immediately" criterion hold without static generation.
 */
export const getActiveCourts = (venueId: string): Promise<PublicCourt[]> =>
  unstable_cache((id: string) => loadActiveCourts(id), ['courts', 'active'], {
    tags: [courtsCacheTag(venueId)],
    revalidate: 60,
  })(venueId)

export async function getActiveCourtById(
  courtId: string,
  venueId: string,
): Promise<PublicCourt | null> {
  const courts = await getActiveCourts(venueId)
  return courts.find((court) => court.id === courtId) ?? null
}

/**
 * Court display names for historical records.
 *
 * The `bookings` module needs a court name for a booking that may reference a
 * court since disabled, and Doc 04 §3 forbids it querying the `courts` table
 * directly. This is that boundary: one service function, no other court detail
 * leaked, venue scope still enforced.
 *
 * Not cached — it is called from the booking-status path, which must always
 * read live (Doc 24 §M item 2).
 */
export async function getCourtNames(
  venueId: string,
  courtIds: readonly string[],
): Promise<Map<string, string>> {
  const rows = await repo.listCourtNames(venueId, courtIds)
  return new Map(rows.map((row) => [row.id, row.name]))
}
