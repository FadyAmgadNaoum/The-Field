import { index, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { adminUsers } from './admin-users'
import { venues } from './venues'

/**
 * CMS key-value settings (Doc 05 §4.15, Doc 09 §3.1).
 *
 * Holds every piece of business-critical text and configuration that must be
 * editable without a deployment: venue contact details, homepage hero copy,
 * SEO metadata, and the InstaPay number.
 *
 * The table starts EMPTY. No placeholder InstaPay number, phone number or
 * address is ever seeded — the payment step is disabled until the venue owner
 * supplies the real value (Doc 22 §10.2, Doc 24 §G.4).
 */
export const cmsSiteSettings = pgTable(
  'cms_site_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    key: varchar('key', { length: 100 }).notNull(),
    value: text('value'),
    valueType: varchar('value_type', { length: 20 }).notNull().default('text'),
    /** Human-readable label for the admin form. */
    label: varchar('label', { length: 255 }),
    /** Tab grouping: general | contact | payment | homepage | about | seo. */
    groupName: varchar('group_name', { length: 100 }),
    updatedBy: uuid('updated_by').references(() => adminUsers.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uqCmsKey: unique('uq_cms_key').on(table.venueId, table.key),
    idxCmsGroup: index('idx_cms_group').on(table.venueId, table.groupName),
  }),
)

export type CmsSiteSetting = typeof cmsSiteSettings.$inferSelect
export type NewCmsSiteSetting = typeof cmsSiteSettings.$inferInsert
