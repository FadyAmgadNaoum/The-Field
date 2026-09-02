import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { operatingHours, venues } from '@/db/schema'

/**
 * Venue data access (Doc 22 M3-T01, read side).
 *
 * Milestone 2 needs only the read half: the About page shows opening hours and
 * the layout shows the venue name. `isDateOperational`, blocked dates and
 * maintenance periods belong to the availability engine in Milestone 3 and are
 * deliberately absent here.
 */

export interface VenueProfile {
  id: string
  name: string
  description: string | null
  address: string | null
  city: string | null
  country: string | null
  timezone: string
  currency: string
  bookingRefPrefix: string
}

export async function findVenue(venueId: string): Promise<VenueProfile | null> {
  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      description: venues.description,
      address: venues.address,
      city: venues.city,
      country: venues.country,
      timezone: venues.timezone,
      currency: venues.currency,
      bookingRefPrefix: venues.bookingRefPrefix,
    })
    .from(venues)
    .where(and(eq(venues.id, venueId), isNull(venues.deletedAt)))
    .limit(1)

  return rows[0] ?? null
}

export interface OperatingHoursRow {
  dayOfWeek: number
  openTime: string
  closeTime: string
  isActive: boolean
}

/**
 * Configured opening hours, ordered Sunday (0) to Saturday (6).
 *
 * Returns an empty array while OBD-004 is unresolved — the table is not seeded
 * (Doc 24 §D.4) and callers must render "coming soon" rather than inventing a
 * schedule (Doc 22 §10.5).
 */
export async function listOperatingHours(venueId: string): Promise<OperatingHoursRow[]> {
  return db
    .select({
      dayOfWeek: operatingHours.dayOfWeek,
      openTime: operatingHours.openTime,
      closeTime: operatingHours.closeTime,
      isActive: operatingHours.isActive,
    })
    .from(operatingHours)
    .where(eq(operatingHours.venueId, venueId))
    .orderBy(asc(operatingHours.dayOfWeek))
}
