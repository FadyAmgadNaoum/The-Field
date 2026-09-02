import { boolean, date, pgTable, text, time, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { adminUsers } from './admin-users'
import { venues } from './venues'

/** CMS events (Doc 05 §4.15, Doc 09 §6.4). Unpublished by default. */
export const cmsEvents = pgTable('cms_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id')
    .notNull()
    .references(() => venues.id, { onDelete: 'restrict' }),
  title: varchar('title', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }),
  description: text('description'),
  eventDate: date('event_date', { mode: 'string' }),
  eventTime: time('event_time'),
  coverImageKey: varchar('cover_image_key', { length: 500 }),
  isPublished: boolean('is_published').notNull().default(false),
  createdBy: uuid('created_by').references(() => adminUsers.id),
  updatedBy: uuid('updated_by').references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export type CmsEvent = typeof cmsEvents.$inferSelect
export type NewCmsEvent = typeof cmsEvents.$inferInsert
