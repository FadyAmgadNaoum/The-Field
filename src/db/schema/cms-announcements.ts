import { boolean, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { adminUsers } from './admin-users'
import { venues } from './venues'

/**
 * CMS announcements (Doc 05 §4.15, Doc 09 §6.5).
 * Public queries filter on `is_published` AND (`expires_at` IS NULL OR in the
 * future) — Doc 22 §10.3.
 */
export const cmsAnnouncements = pgTable('cms_announcements', {
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id')
    .notNull()
    .references(() => venues.id, { onDelete: 'restrict' }),
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  isPublished: boolean('is_published').notNull().default(false),
  createdBy: uuid('created_by').references(() => adminUsers.id),
  updatedBy: uuid('updated_by').references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type CmsAnnouncement = typeof cmsAnnouncements.$inferSelect
export type NewCmsAnnouncement = typeof cmsAnnouncements.$inferInsert
