import {
  bigserial,
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { adminUsers } from './admin-users'

/**
 * Audit action catalogue (Doc 05 §4.14).
 * `payment_proof_viewed` is RC-007a (Doc 21 §3) — every proof view is recorded.
 */
export const auditActionEnum = pgEnum('audit_action', [
  'booking_created',
  'booking_approved',
  'booking_rejected',
  'booking_cancelled',
  'booking_expired',
  'payment_verified',
  'payment_rejected',
  'payment_proof_viewed',
  'court_created',
  'court_updated',
  'court_disabled',
  'pricing_created',
  'pricing_updated',
  'pricing_deleted',
  'schedule_updated',
  'date_blocked',
  'period_blocked',
  'maintenance_created',
  'admin_created',
  'admin_updated',
  'admin_deactivated',
  'cms_updated',
  'admin_login',
  'admin_logout',
  'admin_login_failed',
])

/**
 * Audit log (Doc 05 §4.14).
 *
 * APPEND-ONLY. There is no `updated_at` and no `deleted_at` because rows are
 * never modified or removed. This is enforced at the PostgreSQL role level, not
 * merely in application code — `app_user` has UPDATE and DELETE revoked
 * (Doc 05 §9, Doc 03 NFR-DATA-008, Doc 24 §M item 8).
 *
 * BIGSERIAL rather than UUID so entries have a natural chronological order.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** NULL for system actions such as the booking expiry job (Doc 06 §8). */
    adminId: uuid('admin_id').references(() => adminUsers.id),
    action: auditActionEnum('action').notNull(),
    entityType: varchar('entity_type', { length: 50 }),
    entityId: uuid('entity_id'),
    /** Partial before/after snapshots — changed fields only. */
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    /** IP address, user agent, request id. */
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idxAuditAdmin: index('idx_audit_admin').on(table.adminId, table.createdAt),
    idxAuditEntity: index('idx_audit_entity').on(table.entityType, table.entityId),
    idxAuditCreated: index('idx_audit_created').on(table.createdAt),
  }),
)

export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert
export type AuditAction = (typeof auditActionEnum.enumValues)[number]
