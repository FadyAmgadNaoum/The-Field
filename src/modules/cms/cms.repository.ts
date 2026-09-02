import { and, asc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  cmsAnnouncements,
  cmsEvents,
  cmsFaqs,
  cmsGalleryItems,
  cmsSiteSettings,
  cmsSocialLinks,
} from '@/db/schema'

/**
 * CMS data access (Doc 22 M2-T02, §10.3).
 *
 * Repositories run queries and hold no business logic (Doc 04 §7). Every
 * function takes `venueId` explicitly — it comes from `venueConfig.id` at the
 * service layer and never from a request (Doc 10 §4.4, Doc 24 §M item 16).
 *
 * Soft deletes are honoured everywhere: `deleted_at IS NULL` is part of the
 * predicate, not something a caller remembers to add.
 */

// ── Settings ─────────────────────────────────────────────────────────────────

export async function getSetting(venueId: string, key: string): Promise<string | null> {
  const rows = await db
    .select({ value: cmsSiteSettings.value })
    .from(cmsSiteSettings)
    .where(and(eq(cmsSiteSettings.venueId, venueId), eq(cmsSiteSettings.key, key)))
    .limit(1)

  return rows[0]?.value ?? null
}

export async function getSettingsByKeys(
  venueId: string,
  keys: readonly string[],
): Promise<Record<string, string | null>> {
  if (keys.length === 0) return {}

  const rows = await db
    .select({ key: cmsSiteSettings.key, value: cmsSiteSettings.value })
    .from(cmsSiteSettings)
    .where(and(eq(cmsSiteSettings.venueId, venueId), inArray(cmsSiteSettings.key, [...keys])))

  return Object.fromEntries(rows.map((row) => [row.key, row.value]))
}

export async function getSettingsInGroup(
  venueId: string,
  group: string,
): Promise<Record<string, string | null>> {
  const rows = await db
    .select({ key: cmsSiteSettings.key, value: cmsSiteSettings.value })
    .from(cmsSiteSettings)
    .where(and(eq(cmsSiteSettings.venueId, venueId), eq(cmsSiteSettings.groupName, group)))

  return Object.fromEntries(rows.map((row) => [row.key, row.value]))
}

/**
 * Insert or update one setting.
 *
 * `uq_cms_key` on (venue_id, key) makes the upsert atomic, so two administrators
 * saving the same tab cannot produce a duplicate row.
 */
export async function upsertSetting(input: {
  venueId: string
  key: string
  value: string | null
  valueType: string
  label: string | null
  groupName: string
  adminId: string
}): Promise<void> {
  await db
    .insert(cmsSiteSettings)
    .values({
      venueId: input.venueId,
      key: input.key,
      value: input.value,
      valueType: input.valueType,
      label: input.label,
      groupName: input.groupName,
      updatedBy: input.adminId,
    })
    .onConflictDoUpdate({
      target: [cmsSiteSettings.venueId, cmsSiteSettings.key],
      set: {
        value: input.value,
        valueType: input.valueType,
        label: input.label,
        groupName: input.groupName,
        updatedBy: input.adminId,
        updatedAt: new Date(),
      },
    })
}

// ── FAQs ─────────────────────────────────────────────────────────────────────

export async function listFaqs(venueId: string, publishedOnly: boolean) {
  const conditions = [eq(cmsFaqs.venueId, venueId), isNull(cmsFaqs.deletedAt)]
  if (publishedOnly) conditions.push(eq(cmsFaqs.isPublished, true))

  return db
    .select({
      id: cmsFaqs.id,
      question: cmsFaqs.question,
      answer: cmsFaqs.answer,
      displayOrder: cmsFaqs.displayOrder,
      isPublished: cmsFaqs.isPublished,
    })
    .from(cmsFaqs)
    .where(and(...conditions))
    .orderBy(asc(cmsFaqs.displayOrder), asc(cmsFaqs.createdAt))
}

export async function findFaq(id: string, venueId: string) {
  const rows = await db
    .select({
      id: cmsFaqs.id,
      question: cmsFaqs.question,
      answer: cmsFaqs.answer,
      displayOrder: cmsFaqs.displayOrder,
      isPublished: cmsFaqs.isPublished,
    })
    .from(cmsFaqs)
    .where(and(eq(cmsFaqs.id, id), eq(cmsFaqs.venueId, venueId), isNull(cmsFaqs.deletedAt)))
    .limit(1)

  return rows[0] ?? null
}

export async function nextFaqOrder(venueId: string): Promise<number> {
  const rows = await db
    .select({ max: sql<number | null>`MAX(${cmsFaqs.displayOrder})` })
    .from(cmsFaqs)
    .where(and(eq(cmsFaqs.venueId, venueId), isNull(cmsFaqs.deletedAt)))

  return (rows[0]?.max ?? -1) + 1
}

export async function insertFaq(input: {
  venueId: string
  question: string
  answer: string
  isPublished: boolean
  displayOrder: number
  adminId: string
}) {
  const rows = await db
    .insert(cmsFaqs)
    .values({
      venueId: input.venueId,
      question: input.question,
      answer: input.answer,
      isPublished: input.isPublished,
      displayOrder: input.displayOrder,
      createdBy: input.adminId,
      updatedBy: input.adminId,
    })
    .returning({
      id: cmsFaqs.id,
      question: cmsFaqs.question,
      answer: cmsFaqs.answer,
      displayOrder: cmsFaqs.displayOrder,
      isPublished: cmsFaqs.isPublished,
    })

  return rows[0]
}

export async function updateFaqRow(
  id: string,
  venueId: string,
  patch: { question: string; answer: string; isPublished: boolean },
  adminId: string,
) {
  const rows = await db
    .update(cmsFaqs)
    .set({ ...patch, updatedBy: adminId, updatedAt: new Date() })
    .where(and(eq(cmsFaqs.id, id), eq(cmsFaqs.venueId, venueId), isNull(cmsFaqs.deletedAt)))
    .returning({
      id: cmsFaqs.id,
      question: cmsFaqs.question,
      answer: cmsFaqs.answer,
      displayOrder: cmsFaqs.displayOrder,
      isPublished: cmsFaqs.isPublished,
    })

  return rows[0] ?? null
}

/** Soft delete — Doc 03 NFR-DATA-004. Rows are never removed. */
export async function softDeleteFaq(
  id: string,
  venueId: string,
  adminId: string,
): Promise<boolean> {
  const rows = await db
    .update(cmsFaqs)
    .set({ deletedAt: new Date(), updatedBy: adminId, updatedAt: new Date() })
    .where(and(eq(cmsFaqs.id, id), eq(cmsFaqs.venueId, venueId), isNull(cmsFaqs.deletedAt)))
    .returning({ id: cmsFaqs.id })

  return rows.length > 0
}

export async function setFaqOrder(
  venueId: string,
  orderedIds: readonly string[],
  adminId: string,
): Promise<void> {
  // One transaction so a partial reorder can never be observed.
  await db.transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(cmsFaqs)
        .set({ displayOrder: index, updatedBy: adminId, updatedAt: new Date() })
        .where(and(eq(cmsFaqs.id, id), eq(cmsFaqs.venueId, venueId), isNull(cmsFaqs.deletedAt)))
    }
  })
}

// ── Gallery ──────────────────────────────────────────────────────────────────

export async function listGalleryItems(venueId: string, publishedOnly: boolean) {
  const conditions = [eq(cmsGalleryItems.venueId, venueId), isNull(cmsGalleryItems.deletedAt)]
  if (publishedOnly) conditions.push(eq(cmsGalleryItems.isPublished, true))

  return db
    .select({
      id: cmsGalleryItems.id,
      storageKey: cmsGalleryItems.storageKey,
      caption: cmsGalleryItems.caption,
      category: cmsGalleryItems.category,
      displayOrder: cmsGalleryItems.displayOrder,
      isPublished: cmsGalleryItems.isPublished,
    })
    .from(cmsGalleryItems)
    .where(and(...conditions))
    .orderBy(asc(cmsGalleryItems.displayOrder), asc(cmsGalleryItems.createdAt))
}

export async function insertGalleryItem(input: {
  venueId: string
  storageKey: string
  caption: string | null
  category: string | null
  isPublished: boolean
  displayOrder: number
  adminId: string
}) {
  const rows = await db
    .insert(cmsGalleryItems)
    .values({
      venueId: input.venueId,
      storageKey: input.storageKey,
      caption: input.caption,
      category: input.category,
      isPublished: input.isPublished,
      displayOrder: input.displayOrder,
      uploadedBy: input.adminId,
    })
    .returning({
      id: cmsGalleryItems.id,
      storageKey: cmsGalleryItems.storageKey,
      caption: cmsGalleryItems.caption,
      category: cmsGalleryItems.category,
      displayOrder: cmsGalleryItems.displayOrder,
      isPublished: cmsGalleryItems.isPublished,
    })

  return rows[0]
}

export async function nextGalleryOrder(venueId: string): Promise<number> {
  const rows = await db
    .select({ max: sql<number | null>`MAX(${cmsGalleryItems.displayOrder})` })
    .from(cmsGalleryItems)
    .where(and(eq(cmsGalleryItems.venueId, venueId), isNull(cmsGalleryItems.deletedAt)))

  return (rows[0]?.max ?? -1) + 1
}

export async function findGalleryItem(id: string, venueId: string) {
  const rows = await db
    .select({ id: cmsGalleryItems.id, storageKey: cmsGalleryItems.storageKey })
    .from(cmsGalleryItems)
    .where(
      and(
        eq(cmsGalleryItems.id, id),
        eq(cmsGalleryItems.venueId, venueId),
        isNull(cmsGalleryItems.deletedAt),
      ),
    )
    .limit(1)

  return rows[0] ?? null
}

export async function softDeleteGalleryItem(id: string, venueId: string): Promise<boolean> {
  const rows = await db
    .update(cmsGalleryItems)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(cmsGalleryItems.id, id),
        eq(cmsGalleryItems.venueId, venueId),
        isNull(cmsGalleryItems.deletedAt),
      ),
    )
    .returning({ id: cmsGalleryItems.id })

  return rows.length > 0
}

// ── Events ───────────────────────────────────────────────────────────────────

export async function listEvents(venueId: string, publishedOnly: boolean) {
  const conditions = [eq(cmsEvents.venueId, venueId), isNull(cmsEvents.deletedAt)]
  if (publishedOnly) conditions.push(eq(cmsEvents.isPublished, true))

  return db
    .select({
      id: cmsEvents.id,
      title: cmsEvents.title,
      slug: cmsEvents.slug,
      description: cmsEvents.description,
      eventDate: cmsEvents.eventDate,
      eventTime: cmsEvents.eventTime,
      coverImageKey: cmsEvents.coverImageKey,
      isPublished: cmsEvents.isPublished,
    })
    .from(cmsEvents)
    .where(and(...conditions))
    .orderBy(asc(cmsEvents.eventDate), asc(cmsEvents.createdAt))
}

export async function insertEvent(input: {
  venueId: string
  title: string
  slug: string | null
  description: string | null
  eventDate: string | null
  eventTime: string | null
  isPublished: boolean
  adminId: string
}) {
  const rows = await db
    .insert(cmsEvents)
    .values({
      venueId: input.venueId,
      title: input.title,
      slug: input.slug,
      description: input.description,
      eventDate: input.eventDate,
      eventTime: input.eventTime,
      isPublished: input.isPublished,
      createdBy: input.adminId,
      updatedBy: input.adminId,
    })
    .returning({ id: cmsEvents.id })

  return rows[0]
}

export async function updateEventRow(
  id: string,
  venueId: string,
  patch: {
    title: string
    slug: string | null
    description: string | null
    eventDate: string | null
    eventTime: string | null
    isPublished: boolean
  },
  adminId: string,
): Promise<boolean> {
  const rows = await db
    .update(cmsEvents)
    .set({ ...patch, updatedBy: adminId, updatedAt: new Date() })
    .where(and(eq(cmsEvents.id, id), eq(cmsEvents.venueId, venueId), isNull(cmsEvents.deletedAt)))
    .returning({ id: cmsEvents.id })

  return rows.length > 0
}

export async function softDeleteEvent(
  id: string,
  venueId: string,
  adminId: string,
): Promise<boolean> {
  const rows = await db
    .update(cmsEvents)
    .set({ deletedAt: new Date(), updatedBy: adminId, updatedAt: new Date() })
    .where(and(eq(cmsEvents.id, id), eq(cmsEvents.venueId, venueId), isNull(cmsEvents.deletedAt)))
    .returning({ id: cmsEvents.id })

  return rows.length > 0
}

// ── Announcements ────────────────────────────────────────────────────────────

/** Published and not expired (Doc 22 §10.3). */
export async function listActiveAnnouncements(venueId: string) {
  return db
    .select({
      id: cmsAnnouncements.id,
      title: cmsAnnouncements.title,
      body: cmsAnnouncements.body,
      expiresAt: cmsAnnouncements.expiresAt,
      isPublished: cmsAnnouncements.isPublished,
    })
    .from(cmsAnnouncements)
    .where(
      and(
        eq(cmsAnnouncements.venueId, venueId),
        eq(cmsAnnouncements.isPublished, true),
        or(isNull(cmsAnnouncements.expiresAt), gt(cmsAnnouncements.expiresAt, new Date())),
      ),
    )
    .orderBy(asc(cmsAnnouncements.createdAt))
}

export async function listAllAnnouncements(venueId: string) {
  return db
    .select({
      id: cmsAnnouncements.id,
      title: cmsAnnouncements.title,
      body: cmsAnnouncements.body,
      expiresAt: cmsAnnouncements.expiresAt,
      isPublished: cmsAnnouncements.isPublished,
    })
    .from(cmsAnnouncements)
    .where(eq(cmsAnnouncements.venueId, venueId))
    .orderBy(asc(cmsAnnouncements.createdAt))
}

export async function insertAnnouncement(input: {
  venueId: string
  title: string
  body: string
  expiresAt: Date | null
  isPublished: boolean
  adminId: string
}) {
  const rows = await db
    .insert(cmsAnnouncements)
    .values({
      venueId: input.venueId,
      title: input.title,
      body: input.body,
      expiresAt: input.expiresAt,
      isPublished: input.isPublished,
      createdBy: input.adminId,
      updatedBy: input.adminId,
    })
    .returning({ id: cmsAnnouncements.id })

  return rows[0]
}

export async function updateAnnouncementRow(
  id: string,
  venueId: string,
  patch: { title: string; body: string; expiresAt: Date | null; isPublished: boolean },
  adminId: string,
): Promise<boolean> {
  const rows = await db
    .update(cmsAnnouncements)
    .set({ ...patch, updatedBy: adminId, updatedAt: new Date() })
    .where(and(eq(cmsAnnouncements.id, id), eq(cmsAnnouncements.venueId, venueId)))
    .returning({ id: cmsAnnouncements.id })

  return rows.length > 0
}

/**
 * Retire an announcement.
 *
 * ── WHY THIS IS AN UPDATE AND NOT A DELETE ───────────────────────────────────
 * `cms_announcements` is the one CMS collection with no `deleted_at` column
 * (Doc 05 §4.19), so the obvious implementation is a hard DELETE. That does not
 * work, and would not have failed until production: the runtime role is granted
 * `SELECT, INSERT, UPDATE` and nothing else
 * (`src/db/migrations/raw/0004_privileges.sql`), so `app_user` has no DELETE
 * right on ANY table — the explicit REVOKEs on bookings and audit_logs are
 * belt-and-braces on top of a grant that never included it.
 *
 * Unpublishing and back-dating the expiry produces the identical customer-facing
 * outcome — `listActiveAnnouncements` filters on both — while satisfying
 * Doc 03 NFR-DATA-004's soft-deletion requirement and needing no schema change
 * and no widening of the database role.
 */
export async function retireAnnouncement(id: string, venueId: string): Promise<boolean> {
  const rows = await db
    .update(cmsAnnouncements)
    .set({ isPublished: false, expiresAt: new Date(), updatedAt: new Date() })
    .where(and(eq(cmsAnnouncements.id, id), eq(cmsAnnouncements.venueId, venueId)))
    .returning({ id: cmsAnnouncements.id })

  return rows.length > 0
}

// ── Social links ─────────────────────────────────────────────────────────────

export async function listSocialLinks(venueId: string, activeOnly: boolean) {
  const conditions = [eq(cmsSocialLinks.venueId, venueId)]
  if (activeOnly) {
    conditions.push(eq(cmsSocialLinks.isActive, true))
    // A cleared link keeps its row (see `clearSocialLink`) with an empty URL.
    // Excluding it here means the footer can never render a dead anchor.
    conditions.push(ne(cmsSocialLinks.url, ''))
  }

  return db
    .select({
      id: cmsSocialLinks.id,
      platform: cmsSocialLinks.platform,
      url: cmsSocialLinks.url,
      displayOrder: cmsSocialLinks.displayOrder,
      isActive: cmsSocialLinks.isActive,
    })
    .from(cmsSocialLinks)
    .where(and(...conditions))
    .orderBy(asc(cmsSocialLinks.displayOrder), asc(cmsSocialLinks.platform))
}

export async function upsertSocialLink(input: {
  venueId: string
  platform: string
  url: string
  isActive: boolean
  displayOrder: number
  adminId: string
}): Promise<void> {
  await db
    .insert(cmsSocialLinks)
    .values({
      venueId: input.venueId,
      platform: input.platform,
      url: input.url,
      isActive: input.isActive,
      displayOrder: input.displayOrder,
      updatedBy: input.adminId,
    })
    .onConflictDoUpdate({
      target: [cmsSocialLinks.venueId, cmsSocialLinks.platform],
      set: {
        url: input.url,
        isActive: input.isActive,
        updatedBy: input.adminId,
        updatedAt: new Date(),
      },
    })
}

/**
 * Clear a social link.
 *
 * An UPDATE rather than a DELETE for the same reason as `retireAnnouncement`
 * above: `app_user` holds no DELETE right on any table. Blanking the URL and
 * deactivating the row removes it from the footer — `listSocialLinks` filters
 * on `is_active`, and the service additionally drops empty URLs so no anchor
 * can ever render without a destination.
 */
export async function clearSocialLink(venueId: string, platform: string): Promise<boolean> {
  const rows = await db
    .update(cmsSocialLinks)
    .set({ url: '', isActive: false, updatedAt: new Date() })
    .where(and(eq(cmsSocialLinks.venueId, venueId), eq(cmsSocialLinks.platform, platform)))
    .returning({ id: cmsSocialLinks.id })

  return rows.length > 0
}
