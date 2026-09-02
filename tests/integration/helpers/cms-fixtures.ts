import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  bookings,
  cmsAnnouncements,
  cmsFaqs,
  cmsGalleryItems,
  cmsSiteSettings,
  cmsSocialLinks,
  courtImages,
  courtPricingRules,
  courts,
  paymentRecords,
  venues,
} from '@/db/schema'
import { venueConfig } from '@/lib/config'

/**
 * Fixtures for the Milestone 2 integration tests.
 *
 * ── WHY THESE USE THE MIGRATION CONNECTION TO CLEAN UP ───────────────────────
 * `app_user` is granted SELECT, INSERT and UPDATE only — it cannot DELETE from
 * any table (`src/db/migrations/raw/0004_privileges.sql`). Removing fixtures is
 * a maintenance operation, so cleanup opens a separate migration-role client,
 * exactly as `helpers/accounts.ts` does.
 *
 * Everything is created against the REAL `venueConfig.id`, because that is the
 * venue the services and routes read. Rows are tracked and removed afterwards.
 */

let counter = 0

function unique(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}-${Math.floor(Math.random() * 1e6)}`
}

const createdCourtIds: string[] = []
const createdBookingIds: string[] = []
const createdSettingKeys: string[] = []
const createdFaqIds: string[] = []
const createdGalleryIds: string[] = []
const createdAnnouncementIds: string[] = []
const createdSocialPlatforms: string[] = []

/** Ensure the configured venue row exists; the seed creates it. */
export async function requireVenue(): Promise<string> {
  const rows = await db
    .select({ id: venues.id })
    .from(venues)
    .where(eq(venues.id, venueConfig.id))
    .limit(1)

  if (!rows[0]) {
    throw new Error(
      `Venue ${venueConfig.id} is missing. Run: npm run db:migrate && npm run db:migrate:raw && npm run db:seed`,
    )
  }
  return rows[0].id
}

export async function createTestCourt(
  options: { isActive?: boolean; name?: string; features?: string[] } = {},
): Promise<{ id: string; name: string }> {
  const name = options.name ?? unique('Court')

  const rows = await db
    .insert(courts)
    .values({
      venueId: venueConfig.id,
      name,
      description: 'Test court',
      isActive: options.isActive ?? true,
      features: options.features ?? ['covered'],
    })
    .returning({ id: courts.id })

  const created = rows[0]
  if (!created) throw new Error('Failed to create test court')

  createdCourtIds.push(created.id)
  return { id: created.id, name }
}

export async function createTestPricingRule(
  courtId: string,
  options: { amount?: string; days?: number[]; start?: string; end?: string } = {},
): Promise<void> {
  await db.insert(courtPricingRules).values({
    courtId,
    label: 'Standard',
    priceAmount: options.amount ?? '350.00',
    applicableDays: options.days ?? [0, 1, 2, 3, 4, 5, 6],
    startTime: options.start ?? '08:00:00',
    endTime: options.end ?? '24:00:00',
    priority: 0,
  })
}

export async function createTestBooking(input: {
  courtId: string
  customerAccountId: string
  reference: string
  status?: 'pending' | 'payment_submitted' | 'approved' | 'rejected'
  date?: string
  startTime?: string
  endTime?: string
  price?: string
  rejectionReason?: string
}): Promise<string> {
  const rows = await db
    .insert(bookings)
    .values({
      bookingReference: input.reference,
      venueId: venueConfig.id,
      courtId: input.courtId,
      customerAccountId: input.customerAccountId,
      bookingDate: input.date ?? '2026-09-10',
      startTime: input.startTime ?? '19:00:00',
      endTime: input.endTime ?? '20:00:00',
      priceAmount: input.price ?? '350.00',
      currency: 'EGP',
      status: input.status ?? 'pending',
      rejectionReason: input.rejectionReason ?? null,
    })
    .returning({ id: bookings.id })

  const created = rows[0]
  if (!created) throw new Error('Failed to create test booking')

  createdBookingIds.push(created.id)
  return created.id
}

export async function createTestPaymentRecord(
  bookingId: string,
  options: {
    status?: 'pending' | 'submitted' | 'verified' | 'rejected'
    rejectionReason?: string
  } = {},
): Promise<void> {
  await db.insert(paymentRecords).values({
    bookingId,
    amount: '350.00',
    status: options.status ?? 'pending',
    rejectionReason: options.rejectionReason ?? null,
  })
}

/** Track a settings key so it is removed after the test. */
export function trackSettingKey(key: string): void {
  createdSettingKeys.push(key)
}

export function trackFaqId(id: string): void {
  createdFaqIds.push(id)
}

export function trackGalleryId(id: string): void {
  createdGalleryIds.push(id)
}

export function trackAnnouncementId(id: string): void {
  createdAnnouncementIds.push(id)
}

export function trackSocialPlatform(platform: string): void {
  createdSocialPlatforms.push(platform)
}

/** Remove every tracked fixture. Safe to call when nothing was created. */
export async function cleanupCmsFixtures(): Promise<void> {
  const { default: pg } = await import('pg')
  const client = new pg.Client({
    connectionString: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL,
    application_name: 'thefield-m2-test-cleanup',
  })
  await client.connect()

  try {
    if (createdBookingIds.length > 0) {
      await client.query('DELETE FROM payment_records WHERE booking_id = ANY($1::uuid[])', [
        createdBookingIds,
      ])
      await client.query('DELETE FROM bookings WHERE id = ANY($1::uuid[])', [createdBookingIds])
      createdBookingIds.length = 0
    }
    if (createdCourtIds.length > 0) {
      await client.query('DELETE FROM court_images WHERE court_id = ANY($1::uuid[])', [
        createdCourtIds,
      ])
      await client.query('DELETE FROM court_pricing_rules WHERE court_id = ANY($1::uuid[])', [
        createdCourtIds,
      ])
      await client.query('DELETE FROM courts WHERE id = ANY($1::uuid[])', [createdCourtIds])
      createdCourtIds.length = 0
    }
    if (createdSettingKeys.length > 0) {
      await client.query(
        'DELETE FROM cms_site_settings WHERE venue_id = $1 AND key = ANY($2::varchar[])',
        [venueConfig.id, createdSettingKeys],
      )
      createdSettingKeys.length = 0
    }
    if (createdFaqIds.length > 0) {
      await client.query('DELETE FROM cms_faqs WHERE id = ANY($1::uuid[])', [createdFaqIds])
      createdFaqIds.length = 0
    }
    if (createdGalleryIds.length > 0) {
      await client.query('DELETE FROM cms_gallery_items WHERE id = ANY($1::uuid[])', [
        createdGalleryIds,
      ])
      createdGalleryIds.length = 0
    }
    if (createdAnnouncementIds.length > 0) {
      await client.query('DELETE FROM cms_announcements WHERE id = ANY($1::uuid[])', [
        createdAnnouncementIds,
      ])
      createdAnnouncementIds.length = 0
    }
    if (createdSocialPlatforms.length > 0) {
      await client.query(
        'DELETE FROM cms_social_links WHERE venue_id = $1 AND platform = ANY($2::varchar[])',
        [venueConfig.id, createdSocialPlatforms],
      )
      createdSocialPlatforms.length = 0
    }
    // Audit rows written by the CMS service during a test.
    await client.query("DELETE FROM audit_logs WHERE action = 'cms_updated' AND admin_id IS NULL")
  } finally {
    await client.end()
  }
}

/** Direct reads used by assertions, bypassing the service layer's caching. */
export const inspect = {
  async settingValue(key: string): Promise<string | null> {
    const rows = await db
      .select({ value: cmsSiteSettings.value })
      .from(cmsSiteSettings)
      .where(and(eq(cmsSiteSettings.venueId, venueConfig.id), eq(cmsSiteSettings.key, key)))
      .limit(1)
    return rows[0]?.value ?? null
  },

  async faqById(id: string) {
    const rows = await db.select().from(cmsFaqs).where(eq(cmsFaqs.id, id)).limit(1)
    return rows[0] ?? null
  },

  async galleryByIds(ids: string[]) {
    if (ids.length === 0) return []
    return db.select().from(cmsGalleryItems).where(inArray(cmsGalleryItems.id, ids))
  },

  async announcementById(id: string) {
    const rows = await db
      .select()
      .from(cmsAnnouncements)
      .where(eq(cmsAnnouncements.id, id))
      .limit(1)
    return rows[0] ?? null
  },

  async socialLink(platform: string) {
    const rows = await db
      .select()
      .from(cmsSocialLinks)
      .where(and(eq(cmsSocialLinks.venueId, venueConfig.id), eq(cmsSocialLinks.platform, platform)))
      .limit(1)
    return rows[0] ?? null
  },

  async courtImageCount(courtId: string): Promise<number> {
    const rows = await db.select().from(courtImages).where(eq(courtImages.courtId, courtId))
    return rows.length
  },
}
