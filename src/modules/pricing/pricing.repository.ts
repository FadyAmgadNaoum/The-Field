import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { courtPricingRules } from '@/db/schema'

/**
 * Pricing rule data access (Doc 05 §4.3), read side only.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────
 * Milestone 2 publishes the venue's rate card. It does NOT calculate the price
 * of a booking — `calculatePrice` is Milestone 3 (Doc 24 §N) and lives in the
 * pricing service alongside the booking transaction.
 *
 * This distinction is the price-manipulation guarantee in practice: the public
 * page reads the same rows the server will later use, but the number written to
 * a booking is produced server-side at creation time and is never taken from a
 * client (Doc 13 T-007, Doc 24 §M item 5).
 */

export interface PricingRuleRow {
  id: string
  courtId: string
  label: string
  priceAmount: string
  currency: string
  applicableDays: number[]
  startTime: string
  endTime: string
  priority: number
}

export async function listActiveRulesForCourts(
  courtIds: readonly string[],
): Promise<PricingRuleRow[]> {
  if (courtIds.length === 0) return []

  return (
    db
      .select({
        id: courtPricingRules.id,
        courtId: courtPricingRules.courtId,
        label: courtPricingRules.label,
        priceAmount: courtPricingRules.priceAmount,
        currency: courtPricingRules.currency,
        applicableDays: courtPricingRules.applicableDays,
        startTime: courtPricingRules.startTime,
        endTime: courtPricingRules.endTime,
        priority: courtPricingRules.priority,
      })
      .from(courtPricingRules)
      .where(
        and(
          inArray(courtPricingRules.courtId, [...courtIds]),
          eq(courtPricingRules.isActive, true),
          isNull(courtPricingRules.deletedAt),
        ),
      )
      // Highest priority first — the same ordering the Milestone 3 calculator
      // uses to resolve overlapping rules, so the published card and the applied
      // rate cannot tell different stories.
      .orderBy(desc(courtPricingRules.priority), asc(courtPricingRules.startTime))
  )
}
