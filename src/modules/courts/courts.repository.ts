import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { courtImages, courts } from '@/db/schema'

/**
 * Court data access (Doc 22 M3-T02, read side).
 *
 * ── WHAT "ACTIVE" MEANS ──────────────────────────────────────────────────────
 * `is_active = true` AND `deleted_at IS NULL`. Both conditions live in this
 * repository rather than at call sites, so a court disabled by an administrator
 * disappears from the public site everywhere at once. Doc 22 M2-T07's
 * acceptance criterion is precisely that an inactive court does not appear.
 *
 * Court photos come from the dedicated `court_images` table (Doc 24 §D.5) —
 * never from `cms_gallery_items`, which is owned by the CMS module.
 */

export interface CourtImageRow {
  id: string
  courtId: string
  storageKey: string
  altText: string | null
  displayOrder: number
}

export interface CourtRow {
  id: string
  name: string
  description: string | null
  courtType: string
  features: unknown
  displayOrder: number
}

export async function listActiveCourts(venueId: string): Promise<CourtRow[]> {
  return db
    .select({
      id: courts.id,
      name: courts.name,
      description: courts.description,
      courtType: courts.courtType,
      features: courts.features,
      displayOrder: courts.displayOrder,
    })
    .from(courts)
    .where(and(eq(courts.venueId, venueId), eq(courts.isActive, true), isNull(courts.deletedAt)))
    .orderBy(asc(courts.displayOrder), asc(courts.name))
}

export async function findActiveCourt(courtId: string, venueId: string): Promise<CourtRow | null> {
  const rows = await db
    .select({
      id: courts.id,
      name: courts.name,
      description: courts.description,
      courtType: courts.courtType,
      features: courts.features,
      displayOrder: courts.displayOrder,
    })
    .from(courts)
    .where(
      and(
        eq(courts.id, courtId),
        eq(courts.venueId, venueId),
        eq(courts.isActive, true),
        isNull(courts.deletedAt),
      ),
    )
    .limit(1)

  return rows[0] ?? null
}

/**
 * Names for arbitrary courts, INCLUDING inactive and soft-deleted ones.
 *
 * Used when displaying a historical record such as a booking: the court may
 * since have been disabled, and the customer must still see which court they
 * booked rather than a blank field. Venue scope is still enforced.
 */
export async function listCourtNames(
  venueId: string,
  courtIds: readonly string[],
): Promise<{ id: string; name: string }[]> {
  if (courtIds.length === 0) return []

  return db
    .select({ id: courts.id, name: courts.name })
    .from(courts)
    .where(and(eq(courts.venueId, venueId), inArray(courts.id, [...courtIds])))
}

/**
 * Images for several courts in one query.
 *
 * Called once per page with every court id, rather than once per court —
 * otherwise a venue with a dozen courts issues a dozen round trips on every
 * render of the courts page.
 */
export async function listImagesForCourts(courtIds: readonly string[]): Promise<CourtImageRow[]> {
  if (courtIds.length === 0) return []

  return db
    .select({
      id: courtImages.id,
      courtId: courtImages.courtId,
      storageKey: courtImages.storageKey,
      altText: courtImages.altText,
      displayOrder: courtImages.displayOrder,
    })
    .from(courtImages)
    .where(and(inArray(courtImages.courtId, [...courtIds]), isNull(courtImages.deletedAt)))
    .orderBy(asc(courtImages.displayOrder), asc(courtImages.createdAt))
}
