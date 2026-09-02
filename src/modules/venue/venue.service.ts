import { unstable_cache } from 'next/cache'
import * as repo from './venue.repository'
import type { OperatingHoursRow, VenueProfile } from './venue.repository'

/**
 * Venue service — read side (Doc 22 M3-T01, Doc 04 §3).
 *
 * The venue row and its opening hours change rarely and are read on almost
 * every public page, so both are cached behind the venue tag with a 60-second
 * fallback. Nothing here touches availability or bookings, which are never
 * cached (Doc 24 §M item 2).
 */

export function venueCacheTag(venueId: string): string {
  return `venue-${venueId}`
}

export const getVenueProfile = (venueId: string): Promise<VenueProfile | null> =>
  unstable_cache((id: string) => repo.findVenue(id), ['venue', 'profile'], {
    tags: [venueCacheTag(venueId)],
    revalidate: 60,
  })(venueId)

export const getOperatingHours = (venueId: string): Promise<OperatingHoursRow[]> =>
  unstable_cache((id: string) => repo.listOperatingHours(id), ['venue', 'hours'], {
    tags: [venueCacheTag(venueId)],
    revalidate: 60,
  })(venueId)

/**
 * True when the venue has at least one active operating day configured.
 *
 * OBD-004 is unresolved and the table ships empty (Doc 24 §L). Public pages use
 * this to decide between showing a schedule and showing "coming soon" — they
 * never fall back to an assumed 08:00–24:00 (Doc 22 Preamble #4).
 */
export async function hasOperatingHours(venueId: string): Promise<boolean> {
  const hours = await getOperatingHours(venueId)
  return hours.some((row) => row.isActive)
}

export type { OperatingHoursRow, VenueProfile }
