import { index, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { adminUsers } from './admin-users'
import { courts } from './courts'

/**
 * Court photographs (Doc 24 §D.5 — new table).
 *
 * Serves FR-ADM-040, FR-ADM-044 and FR-CUS-030 (Doc 02).
 *
 * Doc 22 §11.5 proposed storing these in `cms_gallery_items` with
 * `entity_type`/`entity_id` columns that do not exist. Doc 24 §D.5 rejects that
 * approach because:
 *  - a polymorphic entity_id cannot carry a foreign key (Doc 03 NFR-DATA-006)
 *  - court data would live in a table owned by the `cms` module, violating the
 *    module boundary rule (Doc 04 §3, Doc 22 §1.3)
 *  - every existing gallery query would need `WHERE entity_type IS NULL`, and
 *    each missed call site leaks court photos into the public gallery
 *
 * Visibility follows the court's own `is_active`; there is no separate publish
 * flag. Storage keys use the `courts/{courtId}/` prefix (Doc 12 §3).
 */
export const courtImages = pgTable(
  'court_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courtId: uuid('court_id')
      .notNull()
      .references(() => courts.id, { onDelete: 'restrict' }),
    /** Object storage key — never a public URL (Doc 12 §3). */
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    /** Required for WCAG 2.1 AA (Doc 03 NFR-ACC-003). */
    altText: varchar('alt_text', { length: 255 }),
    displayOrder: integer('display_order').notNull().default(0),
    uploadedBy: uuid('uploaded_by').references(() => adminUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    idxCourtImagesCourt: index('idx_court_images_court').on(table.courtId),
  }),
)

export type CourtImage = typeof courtImages.$inferSelect
export type NewCourtImage = typeof courtImages.$inferInsert
