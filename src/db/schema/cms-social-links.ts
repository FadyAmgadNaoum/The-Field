import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { adminUsers } from './admin-users'
import { venues } from './venues'

/**
 * CMS social links (Doc 05 §4.15, Doc 09 §6.6).
 * One row per platform per venue. URLs must be HTTPS (Doc 09 §7).
 */
export const cmsSocialLinks = pgTable(
  'cms_social_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    platform: varchar('platform', { length: 50 }).notNull(),
    url: text('url').notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    updatedBy: uuid('updated_by').references(() => adminUsers.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uqSocialPlatform: unique('uq_social_platform').on(table.venueId, table.platform),
  }),
)

export type CmsSocialLink = typeof cmsSocialLinks.$inferSelect
export type NewCmsSocialLink = typeof cmsSocialLinks.$inferInsert
