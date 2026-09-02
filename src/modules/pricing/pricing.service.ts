import { unstable_cache } from 'next/cache'
import * as repo from './pricing.repository'

/**
 * Pricing service — read side (Doc 22 M2-T06).
 *
 * Publishes the venue's rate card. Price CALCULATION for a booking is Milestone
 * 3 and is not implemented here: nothing in this module returns a number that a
 * booking could be created with, which is the structural reason a client cannot
 * influence a booking's price at this milestone (Doc 24 §M item 5).
 */

export interface PublicPricingRule {
  id: string
  label: string
  /** Decimal string as stored — never converted to a float for display. */
  priceAmount: string
  currency: string
  /** 0 = Sunday … 6 = Saturday. */
  applicableDays: number[]
  /** 'HH:MM' — venue-local wall-clock, seconds trimmed for display. */
  startTime: string
  endTime: string
  priority: number
}

export interface CourtPricing {
  courtId: string
  rules: PublicPricingRule[]
}

export function pricingCacheTag(venueId: string): string {
  return `pricing-${venueId}`
}

/** PostgreSQL returns TIME as 'HH:MM:SS'. The seconds are always zero here. */
function toDisplayTime(value: string): string {
  return value.slice(0, 5)
}

async function loadPricing(courtIds: string[]): Promise<CourtPricing[]> {
  const rows = await repo.listActiveRulesForCourts(courtIds)

  const byCourt = new Map<string, PublicPricingRule[]>()
  for (const row of rows) {
    const list = byCourt.get(row.courtId) ?? []
    list.push({
      id: row.id,
      label: row.label,
      priceAmount: row.priceAmount,
      currency: row.currency,
      applicableDays: [...row.applicableDays].sort((a, b) => a - b),
      startTime: toDisplayTime(row.startTime),
      endTime: toDisplayTime(row.endTime),
      priority: row.priority,
    })
    byCourt.set(row.courtId, list)
  }

  // Every requested court is represented, including those with no rules, so the
  // page can say "no pricing published for this court yet" (Doc 22 §10.5)
  // rather than silently omitting it.
  return courtIds.map((courtId) => ({ courtId, rules: byCourt.get(courtId) ?? [] }))
}

export const getPricingForCourts = (
  venueId: string,
  courtIds: readonly string[],
): Promise<CourtPricing[]> =>
  unstable_cache((ids: string[]) => loadPricing(ids), ['pricing', 'public'], {
    tags: [pricingCacheTag(venueId)],
    revalidate: 60,
  })([...courtIds])
