import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '../helpers/database'

/**
 * Schema and extension verification (Doc 22 M0-T01/M0-T05, Doc 24 §O).
 *
 * This is the Milestone 0 gate: if any assertion here fails, the double-booking
 * guarantee does not exist and no later milestone may proceed
 * (Doc 20 R-TECH-001, Doc 21 DF-002).
 */

let client: pg.Client

beforeAll(async () => {
  client = await createClient()
})

afterAll(async () => {
  await client?.end()
})

describe('connectivity', () => {
  it('connects and answers a trivial query', async () => {
    const result = await client.query<{ ok: number }>('SELECT 1 AS ok')
    expect(result.rows[0]?.ok).toBe(1)
  })

  it('runs PostgreSQL 16 or newer', async () => {
    // `SHOW server_version` names its column `server_version`; alias it so the
    // shape is explicit rather than depending on the statement's own naming.
    const result = await client.query<{ v: string }>(
      "SELECT current_setting('server_version') AS v",
    )
    const version = result.rows[0]?.v
    expect(version).toBeTruthy()
    const major = Number.parseInt(version!.split('.')[0] ?? '0', 10)
    expect(major).toBeGreaterThanOrEqual(16)
  })
})

describe('required extensions', () => {
  it.each(['btree_gist', 'pgcrypto', 'uuid-ossp'])('has %s installed', async (name) => {
    const result = await client.query('SELECT 1 FROM pg_extension WHERE extname = $1', [name])
    expect(result.rowCount).toBe(1)
  })
})

describe('tables', () => {
  const EXPECTED_TABLES = [
    'venues',
    'admin_roles',
    'admin_role_permissions',
    'admin_users',
    'courts',
    'court_images',
    'court_pricing_rules',
    'operating_hours',
    'blocked_dates',
    'blocked_time_periods',
    'maintenance_periods',
    'customer_accounts',
    'bookings',
    'payment_records',
    'payment_proofs',
    'audit_logs',
    'cms_site_settings',
    'cms_faqs',
    'cms_gallery_items',
    'cms_events',
    'cms_announcements',
    'cms_social_links',
  ]

  it.each(EXPECTED_TABLES)('has table %s', async (table) => {
    const result = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    )
    expect(result.rowCount).toBe(1)
  })
})

describe('booking integrity objects', () => {
  it('has the booking_range generated column', async () => {
    const result = await client.query<{ is_generated: string; generation_expression: string }>(
      `SELECT is_generated, generation_expression
       FROM information_schema.columns
       WHERE table_name = 'bookings' AND column_name = 'booking_range'`,
    )

    expect(result.rowCount).toBe(1)
    expect(result.rows[0]?.is_generated).toBe('ALWAYS')
  })

  it('stores booking_range as tsrange — the immutable representation', async () => {
    // Doc 24 §D.2: the documented TSTZRANGE + AT TIME ZONE expression is not
    // immutable and PostgreSQL rejects it as a generated column.
    const result = await client.query<{ udt_name: string }>(
      `SELECT udt_name FROM information_schema.columns
       WHERE table_name = 'bookings' AND column_name = 'booking_range'`,
    )
    expect(result.rows[0]?.udt_name).toBe('tsrange')
  })

  it('has the no_overlapping_approved_bookings exclusion constraint', async () => {
    const result = await client.query<{ contype: string }>(
      `SELECT contype FROM pg_constraint WHERE conname = 'no_overlapping_approved_bookings'`,
    )
    expect(result.rowCount).toBe(1)
    expect(result.rows[0]?.contype).toBe('x') // 'x' = exclusion
  })

  it('scopes the constraint to approved bookings on the same court', async () => {
    const result = await client.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE conname = 'no_overlapping_approved_bookings'`,
    )
    const definition = result.rows[0]!.def

    expect(definition).toContain('court_id WITH =')
    expect(definition).toContain('booking_range WITH &&')
    expect(definition).toContain("status = 'approved'")
  })

  it('does NOT have chk_booking_date_future — removed by RC-005', async () => {
    const result = await client.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'chk_booking_date_future'`,
    )
    expect(result.rowCount).toBe(0)
  })
})

describe('indexes from RC-006 and DBF-001', () => {
  it.each([
    'uq_court_name_per_venue_active',
    'idx_bookings_admin_list',
    'idx_bookings_expires',
    'idx_customer_accounts_phone',
  ])('has index %s', async (name) => {
    const result = await client.query('SELECT 1 FROM pg_indexes WHERE indexname = $1', [name])
    expect(result.rowCount).toBe(1)
  })

  it('enforces court name uniqueness among active courts only', async () => {
    const result = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_court_name_per_venue_active'`,
    )
    expect(result.rows[0]?.indexdef).toContain('WHERE (deleted_at IS NULL)')
  })
})

describe('audit_action enum', () => {
  it('includes payment_proof_viewed — RC-007a', async () => {
    const result = await client.query(
      `SELECT 1 FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'audit_action' AND e.enumlabel = 'payment_proof_viewed'`,
    )
    expect(result.rowCount).toBe(1)
  })
})

describe('admin_users', () => {
  it('has must_change_password — RC-007b', async () => {
    const result = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'admin_users' AND column_name = 'must_change_password'`,
    )
    expect(result.rowCount).toBe(1)
  })
})

describe('venues', () => {
  it('has booking_ref_prefix — RC-003', async () => {
    const result = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'venues' AND column_name = 'booking_ref_prefix'`,
    )
    expect(result.rowCount).toBe(1)
  })
})

describe('customer_accounts', () => {
  it('has deleted_at — Doc 24 §D.6', async () => {
    const result = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'customer_accounts' AND column_name = 'deleted_at'`,
    )
    expect(result.rowCount).toBe(1)
  })
})
