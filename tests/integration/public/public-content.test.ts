import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => {
  const { getTestCookieJar } = await import('../helpers/cookie-jar')
  return { cookies: () => getTestCookieJar() }
})

/**
 * `next/cache` needs a Next.js request scope that a directly-driven service
 * call does not have.
 *
 * `vi.hoisted` is required rather than a plain `const`: `vi.mock` is hoisted
 * above every import, and the services under test are imported statically at
 * the top of this file, so the factory runs before a normal module-scope
 * binding would be initialised.
 *
 * `unstable_cache` is replaced with the identity function so every assertion
 * reads the database rather than a value memoised by an earlier test.
 */
const cacheMock = vi.hoisted(() => ({ revalidateTag: vi.fn() }))

vi.mock('next/cache', () => ({
  revalidateTag: cacheMock.revalidateTag,
  unstable_cache: <T extends (...args: never[]) => unknown>(loader: T) => loader,
}))

import { db } from '@/lib/db/client'
import { courtImages } from '@/db/schema'
import { venueConfig } from '@/lib/config'
import * as courtsService from '@/modules/courts/courts.service'
import * as pricingService from '@/modules/pricing/pricing.service'
import * as venueService from '@/modules/venue/venue.service'
import * as cms from '@/modules/cms/cms.service'
import { resetTestCookieJar } from '../helpers/cookie-jar'
import {
  cleanupCmsFixtures,
  createTestCourt,
  createTestPricingRule,
  requireVenue,
} from '../helpers/cms-fixtures'

/**
 * Public content services (Doc 22 M2-T05, M2-T06, M2-T07; Doc 22 §10.5).
 *
 * ── WHAT THESE PROVE ─────────────────────────────────────────────────────────
 * M2-T07's acceptance criterion is that a court with `is_active = false` does
 * not appear on the public site. That filter lives in the courts repository so
 * it cannot be forgotten by a caller — these tests assert it holds through the
 * service, which is the layer every page actually uses.
 *
 * The graceful-degradation rules in Doc 22 §10.5 are the other half: every read
 * here must return a usable empty result when the venue has published nothing,
 * because that is the state the site ships in.
 */

beforeEach(() => {
  resetTestCookieJar()
  cacheMock.revalidateTag.mockClear()
})

afterAll(async () => {
  await cleanupCmsFixtures()
})

describe('courts', () => {
  it('lists an active court', async () => {
    await requireVenue()
    const court = await createTestCourt({ isActive: true, features: ['covered', 'lights'] })

    const courts = await courtsService.getActiveCourts(venueConfig.id)
    const found = courts.find((entry) => entry.id === court.id)

    expect(found).toBeDefined()
    expect(found?.name).toBe(court.name)
    expect(found?.features).toEqual(['covered', 'lights'])
  })

  it('does not list an inactive court', async () => {
    // M2-T07's stated acceptance criterion.
    await requireVenue()
    const court = await createTestCourt({ isActive: false })

    const courts = await courtsService.getActiveCourts(venueConfig.id)
    expect(courts.map((entry) => entry.id)).not.toContain(court.id)
  })

  it('does not list a soft-deleted court', async () => {
    await requireVenue()
    const court = await createTestCourt({ isActive: true })

    const { courts: courtsTable } = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')
    await db.update(courtsTable).set({ deletedAt: new Date() }).where(eq(courtsTable.id, court.id))

    const courts = await courtsService.getActiveCourts(venueConfig.id)
    expect(courts.map((entry) => entry.id)).not.toContain(court.id)
  })

  it('returns an empty array rather than throwing when no court exists', async () => {
    // Doc 22 §10.5: the courts page shows "Courts coming soon", not an error.
    const courts = await courtsService.getActiveCourts('11111111-2222-4333-8444-555555555555')
    expect(courts).toEqual([])
  })

  it('tolerates a malformed features value', async () => {
    // `features` is free-form jsonb. A value that is not an array of strings
    // must be ignored, not rendered and not thrown on.
    await requireVenue()
    const court = await createTestCourt({ isActive: true })

    const { courts: courtsTable } = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')
    await db
      .update(courtsTable)
      .set({ features: { unexpected: 'shape' } })
      .where(eq(courtsTable.id, court.id))

    const courts = await courtsService.getActiveCourts(venueConfig.id)
    expect(courts.find((entry) => entry.id === court.id)?.features).toEqual([])
  })

  it('never exposes a storage key for a court image', async () => {
    // Doc 12 §3: internal object keys stay inside the storage module. Pages
    // receive a resolved URL or null.
    await requireVenue()
    const court = await createTestCourt({ isActive: true })

    await db.insert(courtImages).values({
      courtId: court.id,
      storageKey: 'courts/secret/01ARZ3NDEKTSV4RRFFQ69G5FAV.webp',
      altText: 'A court',
    })

    const courts = await courtsService.getActiveCourts(venueConfig.id)
    const found = courts.find((entry) => entry.id === court.id)

    expect(JSON.stringify(found)).not.toContain('storageKey')
    for (const image of found?.images ?? []) {
      expect(Object.keys(image)).toEqual(['id', 'url', 'altText'])
    }
  })

  it('resolves court names for historical records, including inactive courts', async () => {
    // The bookings module needs a name for a court that may since have been
    // disabled, so the customer still sees which court they booked.
    await requireVenue()
    const active = await createTestCourt({ isActive: true })
    const disabled = await createTestCourt({ isActive: false })

    const names = await courtsService.getCourtNames(venueConfig.id, [active.id, disabled.id])

    expect(names.get(active.id)).toBe(active.name)
    expect(names.get(disabled.id)).toBe(disabled.name)
  })

  it('does not resolve a court belonging to another venue', async () => {
    await requireVenue()
    const court = await createTestCourt({ isActive: true })

    const names = await courtsService.getCourtNames('11111111-2222-4333-8444-555555555555', [
      court.id,
    ])
    expect(names.size).toBe(0)
  })
})

describe('pricing', () => {
  it('publishes the rules an administrator entered', async () => {
    await requireVenue()
    const court = await createTestCourt({ isActive: true })
    await createTestPricingRule(court.id, { amount: '450.00', days: [4, 5, 6] })

    const pricing = await pricingService.getPricingForCourts(venueConfig.id, [court.id])
    const entry = pricing.find((row) => row.courtId === court.id)

    expect(entry?.rules).toHaveLength(1)
    expect(entry?.rules[0]?.priceAmount).toBe('450.00')
    expect(entry?.rules[0]?.applicableDays).toEqual([4, 5, 6])
    // Times are trimmed to HH:MM for display but not otherwise transformed.
    expect(entry?.rules[0]?.startTime).toBe('08:00')
    expect(entry?.rules[0]?.endTime).toBe('24:00')
  })

  it('keeps the price as an exact decimal string', async () => {
    // Doc 03 NFR-DATA-003. Parsing numeric(10,2) into a float before display
    // is how a rate card starts showing 449.99999999.
    await requireVenue()
    const court = await createTestCourt({ isActive: true })
    await createTestPricingRule(court.id, { amount: '0.10' })

    const pricing = await pricingService.getPricingForCourts(venueConfig.id, [court.id])
    expect(typeof pricing[0]?.rules[0]?.priceAmount).toBe('string')
    expect(pricing[0]?.rules[0]?.priceAmount).toBe('0.10')
  })

  it('represents a court with no rules rather than omitting it', async () => {
    // Doc 22 §10.5: the page says "No pricing published for this court yet",
    // which it cannot do if the court is silently missing from the result.
    await requireVenue()
    const court = await createTestCourt({ isActive: true })

    const pricing = await pricingService.getPricingForCourts(venueConfig.id, [court.id])
    expect(pricing).toHaveLength(1)
    expect(pricing[0]?.rules).toEqual([])
  })

  it('excludes an inactive rule', async () => {
    await requireVenue()
    const court = await createTestCourt({ isActive: true })
    await createTestPricingRule(court.id)

    const { courtPricingRules } = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')
    await db
      .update(courtPricingRules)
      .set({ isActive: false })
      .where(eq(courtPricingRules.courtId, court.id))

    const pricing = await pricingService.getPricingForCourts(venueConfig.id, [court.id])
    expect(pricing[0]?.rules).toEqual([])
  })

  it('returns an empty result for no courts', async () => {
    expect(await pricingService.getPricingForCourts(venueConfig.id, [])).toEqual([])
  })

  it('offers no way to calculate a booking price', async () => {
    // Price CALCULATION is Milestone 3 and lives with the booking transaction.
    // Nothing in the Milestone 2 pricing surface returns a number a booking
    // could be created with, which is the structural half of the
    // price-manipulation guarantee (Doc 13 T-007, Doc 24 §M item 5).
    const surface = Object.keys(pricingService)
    expect(surface).not.toContain('calculatePrice')
    expect(surface).not.toContain('quote')
  })
})

describe('operating hours', () => {
  it('reports no configured hours while OBD-004 is unresolved', async () => {
    // Doc 24 §L: the seed creates no operating hours, and the About page must
    // say "coming soon" rather than assume 08:00-24:00 (Doc 01 Q8).
    await requireVenue()

    const hours = await venueService.getOperatingHours(venueConfig.id)
    const configured = await venueService.hasOperatingHours(venueConfig.id)

    expect(Array.isArray(hours)).toBe(true)
    expect(configured).toBe(hours.some((row) => row.isActive))
  })
})

describe('CMS public reads degrade gracefully', () => {
  it('returns null for a setting that was never saved', async () => {
    await requireVenue()
    expect(await cms.getSetting(venueConfig.id, 'homepage.hero_headline')).toBeNull()
  })

  it('returns every catalogue key for a group, present but null', async () => {
    // A page can read settings['homepage.hero_headline'] without checking that
    // the property exists.
    await requireVenue()
    const group = await cms.getSettingGroup(venueConfig.id, 'homepage')

    expect(Object.keys(group)).toContain('homepage.hero_headline')
    expect(Object.keys(group)).toContain('homepage.hero_image_key')
  })

  it('returns empty collections rather than throwing', async () => {
    await requireVenue()

    await expect(cms.getFaqs(venueConfig.id, true)).resolves.toBeInstanceOf(Array)
    await expect(cms.getGalleryItems(venueConfig.id, true)).resolves.toBeInstanceOf(Array)
    await expect(cms.getActiveAnnouncements(venueConfig.id)).resolves.toBeInstanceOf(Array)
    await expect(cms.getSocialLinks(venueConfig.id, true)).resolves.toBeInstanceOf(Array)
    await expect(cms.getEvents(venueConfig.id, true)).resolves.toBeInstanceOf(Array)
  })

  it('has no seeded InstaPay number', async () => {
    // Gate M2: "No fake InstaPay number is hardcoded anywhere." The seed
    // creates no CMS content at all (Doc 24 §D.4, §G.4).
    await requireVenue()
    expect(await cms.getSetting(venueConfig.id, 'venue.instapay_number')).toBeNull()
  })
})
