import { boolean, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { adminUsers } from './admin-users'
import { venues } from './venues'

/**
 * CMS gallery images (Doc 05 §4.15, Doc 09 §6.3).
 *
 * Public media stored under the `cms/gallery/` prefix in the PUBLIC bucket
 * (Doc 12 §3).
 *
 * This table holds gallery content ONLY. Court photographs live in
 * `court_images` — Doc 22 §11.5 proposed polymorphic entity_type/entity_id
 * columns here, which Doc 24 §D.5 rejects. Adding them would change the result
 * set of every existing gallery query.
 */
export const cmsGalleryItems = pgTable('cms_gallery_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id')
    .notNull()
    .references(() => venues.id, { onDelete: 'restrict' }),
  storageKey: varchar('storage_key', { length: 500 }).notNull(),
  caption: text('caption'),
  category: varchar('category', { length: 100 }),
  displayOrder: integer('display_order').notNull().default(0),
  isPublished: boolean('is_published').notNull().default(true),
  uploadedBy: uuid('uploaded_by').references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export type CmsGalleryItem = typeof cmsGalleryItems.$inferSelect
export type NewCmsGalleryItem = typeof cmsGalleryItems.$inferInsert
