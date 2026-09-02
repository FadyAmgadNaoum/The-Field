import { db } from '@/lib/db/client'
import { auditLogs, type AuditAction } from '@/db/schema'
import { logger } from '@/lib/logger'

/**
 * Append-only audit log writer (Doc 05 §4.14, Doc 22 M1-T13, Doc 24 §M item 8).
 *
 * There is no update and no delete function here, and there never will be. The
 * guarantee is also enforced below the application: `app_user` has UPDATE and
 * DELETE revoked on this table, so even a compromised process cannot rewrite
 * history (verified by tests/integration/db/privileges.test.ts).
 *
 * NOTHING SENSITIVE GOES IN. Doc 13 T-018 and Doc 23 §12.4 forbid passwords,
 * password hashes, session secrets, OAuth secrets, payment proof contents and
 * customer phone numbers in log output. `sanitiseMetadata` strips them here
 * rather than relying on every call site to remember.
 */

/** Never written to audit_logs.metadata, at any nesting depth. */
const FORBIDDEN_METADATA_KEYS = [
  'password',
  'passwordhash',
  'password_hash',
  'newpassword',
  'currentpassword',
  'sessionsecret',
  'session_secret',
  'clientsecret',
  'client_secret',
  'googleclientsecret',
  'accesstoken',
  'access_token',
  'idtoken',
  'id_token',
  'refreshtoken',
  'refresh_token',
  'codeverifier',
  'code_verifier',
  'phone',
  'phonenumber',
  'phone_number',
  'customerphone',
  'storagekey',
  'storage_key',
  'proof',
  'cookie',
  'authorization',
]

function isForbiddenKey(key: string): boolean {
  const normalised = key.toLowerCase()
  return FORBIDDEN_METADATA_KEYS.some((forbidden) => normalised.includes(forbidden))
}

export function sanitiseMetadata(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => sanitiseMetadata(item, depth + 1))

  const output: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isForbiddenKey(key) ? '[REDACTED]' : sanitiseMetadata(nested, depth + 1)
  }
  return output
}

export interface AuditEntry {
  action: AuditAction
  /** NULL for system actions such as the expiry job (Doc 06 §8). */
  adminId?: string | null
  entityType?: string | null
  entityId?: string | null
  oldValue?: unknown
  newValue?: unknown
  metadata?: Record<string, unknown>
}

function toRow(entry: AuditEntry) {
  return {
    action: entry.action,
    adminId: entry.adminId ?? null,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    oldValue: entry.oldValue === undefined ? null : sanitiseMetadata(entry.oldValue),
    newValue: entry.newValue === undefined ? null : sanitiseMetadata(entry.newValue),
    metadata: entry.metadata === undefined ? null : sanitiseMetadata(entry.metadata),
  }
}

/**
 * Write an audit entry.
 *
 * Failure to audit must never take down the operation being audited — a login
 * that succeeded should not report failure because the log write failed. The
 * error is captured instead, where the monitoring stack will surface it
 * (Doc 23 §12.2).
 */
export async function log(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values(toRow(entry))
  } catch (error) {
    logger.error(
      { err: error, action: entry.action, component: 'audit' },
      'Failed to write audit log entry',
    )
  }
}

/**
 * Write an audit entry inside an existing transaction, so the record and the
 * state change it describes commit or roll back together (Doc 22 §8.4).
 *
 * Unlike `log`, this deliberately propagates errors: inside a transaction a
 * failed audit write must abort the whole operation rather than leave an
 * unrecorded state change.
 */
export async function logTx(tx: { insert: typeof db.insert }, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values(toRow(entry))
}
