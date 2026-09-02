import { revalidateTag, unstable_cache } from 'next/cache'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { sanitizeCmsHtml } from '@/lib/cms-sanitize'
import { publicUrlFor } from '@/modules/storage/storage.service'
import * as audit from '@/modules/audit/audit.service'
import * as repo from './cms.repository'
import {
  cmsSettingDefinition,
  cmsSettingsInGroup,
  isCmsSettingKey,
  type CmsGroup,
} from './cms.keys'
import type {
  Announcement,
  CmsEventItem,
  CmsSettingMap,
  Faq,
  GalleryItem,
  SocialLink,
} from './cms.types'
import {
  validateSettingValue,
  type AnnouncementInput,
  type EventInput,
  type FaqInput,
} from './cms.validators'

/**
 * CMS service (Doc 22 §10.3, M2-T02; Doc 09 §4.1).
 *
 * Owns three responsibilities the repository deliberately does not:
 *
 *  1. **Validation.** Every write goes through the Doc 09 §7 rules, and rich
 *     text is sanitised before storage (Doc 22 §10.6) so the stored value is
 *     already safe for every present and future reader.
 *  2. **Audit.** Each setting change writes one `cms_updated` row with the old
 *     and new values (Doc 09 §6.1, Doc 22 §10.3).
 *  3. **Cache invalidation.** Every mutation calls `revalidateTag`, so a saved
 *     change is visible on the public site on the next request (Doc 09 §8).
 *
 * ── VENUE SCOPE ──────────────────────────────────────────────────────────────
 * `venueId` is always supplied by the caller from `venueConfig.id`. It is never
 * read from a request. Every write additionally re-checks the row's venue, so a
 * guessed id cannot reach another venue's content (Doc 22 §10.3 IDOR guard).
 */

export function cmsCacheTag(venueId: string): string {
  return `cms-${venueId}`
}

export function courtsCacheTag(venueId: string): string {
  return `courts-${venueId}`
}

/**
 * Cache wrapper for public reads (Doc 22 §10.4).
 *
 * The 60-second `revalidate` is a fallback only — the authority is the tag,
 * which every mutation invalidates immediately. Availability and booking data
 * are NEVER cached (Doc 24 §M item 2); nothing in this module touches them.
 */
function cachedByTag<TArgs extends unknown[], TResult>(
  loader: (...args: TArgs) => Promise<TResult>,
  parts: string[],
  venueId: string,
) {
  return unstable_cache(loader, ['cms', ...parts], {
    tags: [cmsCacheTag(venueId)],
    revalidate: 60,
  })
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function getSetting(venueId: string, key: string): Promise<string | null> {
  const value = await cachedByTag(
    (id: string, k: string) => repo.getSetting(id, k),
    ['setting'],
    venueId,
  )(venueId, key)

  // An empty string means "the owner cleared this", which every consumer must
  // treat identically to "never set" (Doc 22 §10.5).
  return value === '' ? null : value
}

export async function getSettingGroup(venueId: string, group: CmsGroup): Promise<CmsSettingMap> {
  const stored = await cachedByTag(
    (id: string, g: string) => repo.getSettingsInGroup(id, g),
    ['group'],
    venueId,
  )(venueId, group)

  // Every key in the catalogue is present in the result, so a page can read
  // `settings['homepage.hero_headline']` without checking for the property.
  const result: CmsSettingMap = {}
  for (const definition of cmsSettingsInGroup(group)) {
    const value = stored[definition.key]
    result[definition.key] = value === '' || value === undefined ? null : value
  }
  return result
}

/** Read arbitrary keys across groups in one query. Used by the layout. */
export async function getSettings(
  venueId: string,
  keys: readonly string[],
): Promise<CmsSettingMap> {
  const stored = await cachedByTag(
    (id: string, k: string[]) => repo.getSettingsByKeys(id, k),
    ['keys'],
    venueId,
  )(venueId, [...keys])

  const result: CmsSettingMap = {}
  for (const key of keys) {
    const value = stored[key]
    result[key] = value === '' || value === undefined ? null : value
  }
  return result
}

/**
 * Save every setting in one tab group.
 *
 * Validation runs across the whole group first: a single bad field rejects the
 * save rather than half-applying it, so the administrator never has to work out
 * which fields were written.
 */
export async function updateSettingGroup(
  venueId: string,
  group: CmsGroup,
  submitted: Record<string, string>,
  adminId: string,
): Promise<void> {
  const definitions = cmsSettingsInGroup(group)
  const allowed = new Set(definitions.map((definition) => definition.key))

  const unknown = Object.keys(submitted).filter((key) => !allowed.has(key))
  if (unknown.length > 0) {
    throw new ValidationError('The submitted data is not valid.', {
      fieldErrors: Object.fromEntries(unknown.map((key) => [key, ['Unknown setting.']])),
    })
  }

  const fieldErrors: Record<string, string[]> = {}
  const writes: { key: string; value: string | null }[] = []

  for (const definition of definitions) {
    const raw = submitted[definition.key]
    if (raw === undefined) continue

    const result = validateSettingValue(definition.key, raw)
    if (!result.ok) {
      fieldErrors[definition.key] = [result.message]
      continue
    }

    // Rich text is sanitised before storage, never on read (Doc 22 §10.6).
    const value =
      definition.valueType === 'markdown' && result.value !== ''
        ? sanitizeCmsHtml(result.value)
        : result.value

    writes.push({ key: definition.key, value: value === '' ? null : value })
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError('Some values could not be saved.', { fieldErrors })
  }

  const previous = await repo.getSettingsInGroup(venueId, group)

  for (const write of writes) {
    const definition = cmsSettingDefinition(write.key)
    if (!definition) continue

    const before = previous[write.key] ?? null
    if (before === write.value) continue

    await repo.upsertSetting({
      venueId,
      key: write.key,
      value: write.value,
      valueType: definition.valueType,
      label: definition.label,
      groupName: definition.group,
      adminId,
    })

    await audit.log({
      action: 'cms_updated',
      adminId,
      entityType: 'cms_site_settings',
      // The key identifies what changed; the row id is an internal detail.
      oldValue: { key: write.key, value: redactSettingValue(write.key, before) },
      newValue: { key: write.key, value: redactSettingValue(write.key, write.value) },
    })
  }

  revalidateTag(cmsCacheTag(venueId))
}

/**
 * The InstaPay number is a payment destination.
 *
 * It belongs in the audit trail — an unexplained change to it is exactly what
 * an audit log exists to catch — but the full value does not need to sit in a
 * jsonb column that many roles can read. Only the last four digits are kept,
 * which is enough to prove that it changed and to which value family.
 */
function redactSettingValue(key: string, value: string | null): string | null {
  if (value === null) return null
  if (key !== 'venue.instapay_number') return value
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`
}

// ── FAQs (Doc 09 §6.2) ───────────────────────────────────────────────────────

export async function getFaqs(venueId: string, publishedOnly: boolean): Promise<Faq[]> {
  if (publishedOnly) {
    return cachedByTag((id: string) => repo.listFaqs(id, true), ['faqs'], venueId)(venueId)
  }
  return repo.listFaqs(venueId, false)
}

export async function createFaq(venueId: string, input: FaqInput, adminId: string): Promise<Faq> {
  const displayOrder = input.displayOrder ?? (await repo.nextFaqOrder(venueId))

  const created = await repo.insertFaq({
    venueId,
    question: input.question,
    answer: input.answer,
    isPublished: input.isPublished,
    displayOrder,
    adminId,
  })
  if (!created) throw new ValidationError('The FAQ could not be created.')

  await audit.log({
    action: 'cms_updated',
    adminId,
    entityType: 'cms_faqs',
    entityId: created.id,
    newValue: { question: created.question, isPublished: created.isPublished },
  })
  revalidateTag(cmsCacheTag(venueId))
  return created
}

export async function updateFaq(
  id: string,
  venueId: string,
  input: FaqInput,
  adminId: string,
): Promise<Faq> {
  // IDOR guard: the update predicate includes venue_id, so a row belonging to
  // another venue simply does not match and the caller gets a 404 — never a
  // signal that the id exists (Doc 22 §10.3, Doc 13 T-004).
  const before = await repo.findFaq(id, venueId)
  if (!before) throw new NotFoundError()

  const updated = await repo.updateFaqRow(
    id,
    venueId,
    { question: input.question, answer: input.answer, isPublished: input.isPublished },
    adminId,
  )
  if (!updated) throw new NotFoundError()

  await audit.log({
    action: 'cms_updated',
    adminId,
    entityType: 'cms_faqs',
    entityId: id,
    oldValue: { question: before.question, isPublished: before.isPublished },
    newValue: { question: updated.question, isPublished: updated.isPublished },
  })
  revalidateTag(cmsCacheTag(venueId))
  return updated
}

export async function deleteFaq(id: string, venueId: string, adminId: string): Promise<void> {
  const removed = await repo.softDeleteFaq(id, venueId, adminId)
  if (!removed) throw new NotFoundError()

  await audit.log({
    action: 'cms_updated',
    adminId,
    entityType: 'cms_faqs',
    entityId: id,
    newValue: { deleted: true },
  })
  revalidateTag(cmsCacheTag(venueId))
}

export async function reorderFaqs(
  venueId: string,
  orderedIds: readonly string[],
  adminId: string,
): Promise<void> {
  await repo.setFaqOrder(venueId, orderedIds, adminId)
  await audit.log({
    action: 'cms_updated',
    adminId,
    entityType: 'cms_faqs',
    newValue: { reordered: orderedIds.length },
  })
  revalidateTag(cmsCacheTag(venueId))
}

// ── Gallery (Doc 09 §6.3) ────────────────────────────────────────────────────

function toGalleryItem(row: {
  id: string
  storageKey: string
  caption: string | null
  category: string | null
  displayOrder: number
  isPublished: boolean
}): GalleryItem {
  return { ...row, imageUrl: publicUrlFor(row.storageKey) }
}

export async function getGalleryItems(
  venueId: string,
  publishedOnly: boolean,
): Promise<GalleryItem[]> {
  const rows = publishedOnly
    ? await cachedByTag(
        (id: string) => repo.listGalleryItems(id, true),
        ['gallery'],
        venueId,
      )(venueId)
    : await repo.listGalleryItems(venueId, false)

  return rows.map(toGalleryItem)
}

export async function createGalleryItem(
  venueId: string,
  input: {
    storageKey: string
    caption: string | null
    category: string | null
    isPublished: boolean
  },
  adminId: string,
): Promise<GalleryItem> {
  const created = await repo.insertGalleryItem({
    venueId,
    storageKey: input.storageKey,
    caption: input.caption,
    category: input.category,
    isPublished: input.isPublished,
    displayOrder: await repo.nextGalleryOrder(venueId),
    adminId,
  })
  if (!created) throw new ValidationError('The image could not be saved.')

  await audit.log({
    action: 'cms_updated',
    adminId,
    entityType: 'cms_gallery_items',
    entityId: created.id,
    // The storage key is redacted by the audit sanitiser; the caption is what
    // identifies the item to a human reader.
    newValue: { caption: created.caption, isPublished: created.isPublished },
  })
  revalidateTag(cmsCacheTag(venueId))
  return toGalleryItem(created)
}

export async function deleteGalleryItem(
  id: string,
  venueId: string,
  adminId: string,
): Promise<void> {
  const existing = await repo.findGalleryItem(id, venueId)
  if (!existing) throw new NotFoundError()

  const removed = await repo.softDeleteGalleryItem(id, venueId)
  if (!removed) throw new NotFoundError()

  // The object itself is deliberately left in storage. A soft-deleted row can
  // be restored by an operator; deleting the bytes would make that impossible
  // and turns a mis-click into permanent data loss. Orphan cleanup is an
  // operational task, not part of the request path.
  await audit.log({
    action: 'cms_updated',
    adminId,
    entityType: 'cms_gallery_items',
    entityId: id,
    newValue: { deleted: true },
  })
  revalidateTag(cmsCacheTag(venueId))
}

// ── Events (Doc 09 §6.4) ─────────────────────────────────────────────────────

export async function getEvents(venueId: string, publishedOnly: boolean): Promise<CmsEventItem[]> {
  const rows = publishedOnly
    ? await cachedByTag((id: string) => repo.listEvents(id, true), ['events'], venueId)(venueId)
    : await repo.listEvents(venueId, false)

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    eventDate: row.eventDate,
    eventTime: row.eventTime,
    coverImageUrl: publicUrlFor(row.coverImageKey),
    isPublished: row.isPublished,
  }))
}

export async function createEvent(
  venueId: string,
  input: EventInput,
  adminId: string,
): Promise<{ id: string }> {
  const created = await repo.insertEvent({
    venueId,
    title: input.title,
    slug: input.slug ?? null,
    description: input.description ? sanitizeCmsHtml(input.description) : null,
    eventDate: input.eventDate ?? null,
    eventTime: input.eventTime ?? null,
    isPublished: input.isPublished,
    adminId,
  })
  if (!created) throw new ValidationError('The event could not be created.')

  await audit.log({
    action: 'cms_updated',
    adminId,
    entityType: 'cms_events',
    entityId: created.id,
    newValue: { title: input.title, isPublished: input.isPublished },
  })
  revalidateTag(cmsCacheTag(venueId))
  return created
}

export async function updateEvent(
  id: string,
  venueId: string,
  input: EventInput,
  adminId: string,
): Promise<void> {
  const updated = await repo.updateEventRow(
    id,
    venueId,
    {
      title: input.title,
      slug: input.slug ?? null,
      description: input.description ? sanitizeCmsHtml(input.description) : null,
      eventDate: input.eventDate ?? null,
      eventTime: input.eventTime ?? null,
      isPublished: input.isPublished,
    },
    adminId,
  )
  if (!updated) throw new NotFoundError()

  await audit.log({
    action: 'cms_updated',
    adminId,
    entityType: 'cms_events',
    entityId: id,
    newValue: { title: input.title, isPublished: input.isPublished },
  })
  revalidateTag(cmsCacheTag(venueId))
}

export async function deleteEvent(id: string, venueId: string, adminId: string): Promise<void> {
  const removed = await repo.softDeleteEvent(id, venueId, adminId)
  if (!removed) throw new NotFoundError()

  await audit.log({
    action: 'cms_updated',
    adminId,
    entityType: 'cms_events',
    entityId: id,
    newValue: { deleted: true },
  })
  revalidateTag(cmsCacheTag(venueId))
}

// ── Announcements (Doc 09 §6.5) ──────────────────────────────────────────────

export async function getActiveAnnouncements(venueId: string): Promise<Announcement[]> {
  return cachedByTag(
    (id: string) => repo.listActiveAnnouncements(id),
    ['announcements'],
    venueId,
  )(venueId)
}

export async function getAllAnnouncements(venueId: string): Promise<Announcement[]> {
  return repo.listAllAnnouncements(venueId)
}

export async function createAnnouncement(
  venueId: string,
  input: AnnouncementInput,
  adminId: string,
): Promise<{ id: string }> {
  const created = await repo.insertAnnouncement({
    venueId,
    title: input.title,
    body: input.body,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    isPublished: input.isPublished,
    adminId,
  })
  if (!created) throw new ValidationError('The announcement could not be created.')

  await audit.log({
    action: 'cms_updated',
    adminId,
    entityType: 'cms_announcements',
    entityId: created.id,
    newValue: { title: input.title, isPublished: input.isPublished },
  })
  revalidateTag(cmsCacheTag(venueId))
  return created
}

export async function updateAnnouncement(
  id: string,
  venueId: string,
  input: AnnouncementInput,
  adminId: string,
): Promise<void> {
  const updated = await repo.updateAnnouncementRow(
    id,
    venueId,
    {
      title: input.title,
      body: input.body,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      isPublished: input.isPublished,
    },
    adminId,
  )
  if (!updated) throw new NotFoundError()

  await audit.log({
    action: 'cms_updated',
    adminId,
    entityType: 'cms_announcements',
    entityId: id,
    newValue: { title: input.title, isPublished: input.isPublished },
  })
  revalidateTag(cmsCacheTag(venueId))
}

/**
 * Take an announcement off the site.
 *
 * Unpublishes it and back-dates the expiry rather than deleting the row — see
 * `repo.retireAnnouncement` for why a hard delete is not available. The
 * customer-facing outcome is identical: `getActiveAnnouncements` filters on
 * both conditions, so the banner disappears immediately.
 */
export async function retireAnnouncement(
  id: string,
  venueId: string,
  adminId: string,
): Promise<void> {
  const retired = await repo.retireAnnouncement(id, venueId)
  if (!retired) throw new NotFoundError()

  await audit.log({
    action: 'cms_updated',
    adminId,
    entityType: 'cms_announcements',
    entityId: id,
    newValue: { retired: true },
  })
  revalidateTag(cmsCacheTag(venueId))
}

// ── Social links (Doc 09 §6.6) ───────────────────────────────────────────────

export async function getSocialLinks(venueId: string, activeOnly = true): Promise<SocialLink[]> {
  if (activeOnly) {
    return cachedByTag((id: string) => repo.listSocialLinks(id, true), ['social'], venueId)(venueId)
  }
  return repo.listSocialLinks(venueId, false)
}

export async function upsertSocialLink(
  venueId: string,
  platform: string,
  url: string,
  isActive: boolean,
  adminId: string,
): Promise<void> {
  // An empty URL clears the link rather than storing a blank one, so the
  // footer never renders an anchor with no destination.
  if (url === '') {
    await repo.clearSocialLink(venueId, platform)
  } else {
    await repo.upsertSocialLink({
      venueId,
      platform,
      url,
      isActive,
      displayOrder: 0,
      adminId,
    })
  }

  await audit.log({
    action: 'cms_updated',
    adminId,
    entityType: 'cms_social_links',
    newValue: { platform, isActive, cleared: url === '' },
  })
  revalidateTag(cmsCacheTag(venueId))
}

export { isCmsSettingKey }
