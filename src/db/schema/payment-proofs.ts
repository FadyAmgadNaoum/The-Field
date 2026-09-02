import { index, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { adminUsers } from './admin-users'
import { inet } from './column-types'
import { paymentRecords } from './payment-records'

/**
 * Uploaded payment proof files (Doc 05 §4.11).
 *
 * `storage_key` is an object key in the PRIVATE R2 bucket — never a public URL
 * (Doc 12 §4). Files are reachable only through a 5-minute presigned URL issued
 * after a permission and venue-scope check, and every view is written to
 * audit_logs as `payment_proof_viewed` (Doc 12 §4.1, Doc 24 §H.2).
 *
 * Multiple proofs per payment are expected and retained — a customer may upload
 * a clearer image, and prior files are kept for audit (Doc 07 §7.5).
 *
 * Rows are never hard-deleted; `app_user` lacks DELETE (Doc 05 §9).
 */
export const paymentProofs = pgTable(
  'payment_proofs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => paymentRecords.id, { onDelete: 'restrict' }),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    /** Retained for reference. NEVER used to build a storage key (Doc 13 T-011). */
    originalFilename: varchar('original_filename', { length: 255 }),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    uploadedByIp: inet('uploaded_by_ip'),
    reviewedBy: uuid('reviewed_by').references(() => adminUsers.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => ({
    idxProofsPayment: index('idx_proofs_payment').on(table.paymentId),
  }),
)

export type PaymentProof = typeof paymentProofs.$inferSelect
export type NewPaymentProof = typeof paymentProofs.$inferInsert
