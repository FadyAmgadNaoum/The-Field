import { afterAll, describe, expect, it } from 'vitest'
import { createClient, sqlState } from '../helpers/database'

/**
 * Database role privileges (Doc 05 §9, Doc 22 §4.4, Doc 24 §D.1, §M item 8).
 *
 * Defence in depth: even a fully compromised application process must not be
 * able to delete a booking or rewrite the audit log, because the connection it
 * holds has no such right.
 *
 * Doc 24 §O requires this to be verified by ACTUALLY ATTEMPTING the forbidden
 * operations. The REVOKEs in Doc 22 §14.1 run before the tables exist and would
 * otherwise silently apply to nothing (Doc 24 §K S19n).
 *
 * The role is resolved at module load rather than in `beforeAll`, because
 * `it.runIf` conditions are evaluated during collection — before any hook has
 * run. Resolving it later made every assertion below skip while the suite still
 * reported green, which is precisely the failure mode this file exists to
 * prevent. The suite now fails loudly if it cannot connect as `app_user`.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for the privilege tests')

const client = await createClient(url)
const identity = await client.query<{ role: string; superuser: boolean }>(
  'SELECT current_user AS role, usesuper AS superuser FROM pg_user WHERE usename = current_user',
)
const role = identity.rows[0]?.role ?? 'unknown'
const isSuperuser = identity.rows[0]?.superuser ?? false

afterAll(async () => {
  await client.end()
})

/** Forbidden statements use `WHERE false` so a missing REVOKE cannot destroy data. */
async function expectDenied(statement: string): Promise<void> {
  await expect(client.query(statement)).rejects.toSatisfy(
    (error: unknown) => sqlState(error) === '42501', // insufficient_privilege
    `expected insufficient_privilege (42501) for: ${statement}`,
  )
}

describe('connection identity', () => {
  it('connects as app_user, not a superuser', () => {
    // A superuser bypasses every grant, so the assertions below would pass
    // vacuously. Fail loudly instead of skipping.
    expect(
      isSuperuser,
      `DATABASE_URL connects as a superuser ("${role}"). Privilege restrictions cannot be ` +
        'verified. Point DATABASE_URL at the app_user connection string (Doc 22 §4.4).',
    ).toBe(false)

    expect(
      role,
      `DATABASE_URL connects as "${role}". The runtime role must be app_user (Doc 22 §4.4).`,
    ).toBe('app_user')
  })
})

describe('app_user cannot destroy financial or booking records', () => {
  it('cannot DELETE from bookings', async () => {
    await expectDenied('DELETE FROM bookings WHERE false')
  })

  it('cannot DELETE from payment_records', async () => {
    await expectDenied('DELETE FROM payment_records WHERE false')
  })

  it('cannot DELETE from payment_proofs', async () => {
    await expectDenied('DELETE FROM payment_proofs WHERE false')
  })
})

describe('audit_logs are append-only at the role level', () => {
  it('cannot UPDATE audit_logs', async () => {
    await expectDenied("UPDATE audit_logs SET entity_type = 'tampered' WHERE false")
  })

  it('cannot DELETE from audit_logs', async () => {
    await expectDenied('DELETE FROM audit_logs WHERE false')
  })

  it('CAN INSERT into audit_logs — the application must still write entries', async () => {
    const result = await client.query(
      `INSERT INTO audit_logs (action, entity_type, metadata)
       VALUES ('admin_login', 'test', '{"source":"privilege-test"}'::jsonb)
       RETURNING id`,
    )
    expect(result.rowCount).toBe(1)

    // Cannot be cleaned up by design — that is the guarantee under test.
    // A superuser removes it below so the suite stays repeatable.
  })
})

describe('app_user retains the rights the application needs', () => {
  it('can SELECT from bookings and audit_logs', async () => {
    await expect(client.query('SELECT 1 FROM bookings WHERE false')).resolves.toBeTruthy()
    await expect(client.query('SELECT 1 FROM audit_logs WHERE false')).resolves.toBeTruthy()
  })

  it('can INSERT and UPDATE bookings', async () => {
    const privileges = await client.query<{ p: string }>(
      `SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) AS p
       FROM information_schema.table_privileges
       WHERE grantee = current_user AND table_name = 'bookings'`,
    )
    const granted = privileges.rows[0]?.p ?? ''
    expect(granted).toContain('INSERT')
    expect(granted).toContain('UPDATE')
    expect(granted).toContain('SELECT')
    expect(granted).not.toContain('DELETE')
  })
})
