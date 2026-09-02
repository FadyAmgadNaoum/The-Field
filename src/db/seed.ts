import '../lib/config/load-env'
import bcrypt from 'bcryptjs'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import pg from 'pg'
import { parseDatabaseEnv } from '../lib/config/env'
import { ROLE_DESCRIPTIONS, ROLE_NAMES, ROLE_PERMISSIONS } from '../lib/rbac/permissions'
import * as schema from './schema'

/**
 * Database seed (Doc 22 M0-T06, §4.5; Doc 24 §D.4).
 *
 * Creates ONLY the minimum required for the application to start:
 *   1. one venue row
 *   2. three administrator roles
 *   3. the 16 permission rows per role
 *   4. one super-administrator, flagged must_change_password
 *
 * It deliberately creates NO courts, NO operating hours, NO pricing rules and
 * NO CMS content. OBD-004 (the venue's real schedule) is unresolved, and
 * inventing business values is prohibited (Doc 22 Preamble #4/#6).
 * Doc 18 §2's "seed 2 courts, operating hours, pricing rules" is stale
 * (Doc 24 §D.4). Development fixtures live in tests/, never here.
 *
 * Idempotent — re-running does not duplicate rows.
 */

const BCRYPT_COST = 12 // Doc 03 NFR-SEC-006

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(
      `${name} is required to seed the initial administrator.\n` +
        'Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in the environment for this one run, ' +
        'then remove them (Doc 22 §4.5).',
    )
  }
  return value.trim()
}

async function main(): Promise<void> {
  const env = parseDatabaseEnv(process.env)
  const connectionString = env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL

  const adminEmail = requireEnv('SEED_ADMIN_EMAIL').toLowerCase()
  const adminPassword = requireEnv('SEED_ADMIN_PASSWORD')

  if (adminPassword.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters (Doc 10 §2.5).')
  }
  if (Buffer.byteLength(adminPassword, 'utf8') > 72) {
    throw new Error('SEED_ADMIN_PASSWORD exceeds bcrypt’s 72-byte input limit (Doc 10 §2.5).')
  }

  const client = new pg.Client({ connectionString, application_name: 'thefield-seed' })
  await client.connect()
  const db = drizzle(client, { schema })

  try {
    // ── 1. Venue ─────────────────────────────────────────────────────────────
    // Name and prefix are structural identifiers, not business content: the
    // customer-facing venue name is CMS-managed (Doc 21 CMSF-001).
    const venueSlug = process.env.VENUE_SLUG ?? 'the-field'

    let [venue] = await db
      .select()
      .from(schema.venues)
      .where(eq(schema.venues.slug, venueSlug))
      .limit(1)

    if (!venue) {
      ;[venue] = await db
        .insert(schema.venues)
        .values({
          slug: venueSlug,
          name: 'The Field',
          timezone: 'Africa/Cairo',
          currency: 'EGP',
          bookingRefPrefix: 'TF',
          isActive: true,
        })
        .returning()
      console.log(`[seed] Created venue "${venueSlug}"`)
    } else {
      console.log(`[seed] Venue "${venueSlug}" already exists`)
    }

    if (!venue) throw new Error('Failed to create or load the venue row.')

    // ── 2. Roles and 3. permissions ──────────────────────────────────────────
    const roleIds = new Map<string, string>()

    for (const roleName of ROLE_NAMES) {
      let [role] = await db
        .select()
        .from(schema.adminRoles)
        .where(eq(schema.adminRoles.name, roleName))
        .limit(1)

      if (!role) {
        ;[role] = await db
          .insert(schema.adminRoles)
          .values({ name: roleName, description: ROLE_DESCRIPTIONS[roleName] })
          .returning()
        console.log(`[seed] Created role "${roleName}"`)
      }

      if (!role) throw new Error(`Failed to create or load role "${roleName}".`)
      roleIds.set(roleName, role.id)

      const permissions = ROLE_PERMISSIONS[roleName]
      await db
        .insert(schema.adminRolePermissions)
        .values(permissions.map((permission) => ({ roleId: role.id, permission })))
        .onConflictDoNothing()

      console.log(`[seed]   ${roleName}: ${permissions.length} permission(s)`)
    }

    const superAdminRoleId = roleIds.get('super_admin')
    if (!superAdminRoleId) throw new Error('super_admin role was not created.')

    // ── 4. Initial super administrator ───────────────────────────────────────
    const [existingAdmin] = await db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.email, adminEmail))
      .limit(1)

    if (existingAdmin) {
      console.log(`[seed] Administrator ${adminEmail} already exists — left unchanged`)
    } else {
      const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_COST)
      await db.insert(schema.adminUsers).values({
        email: adminEmail,
        passwordHash,
        fullName: 'Initial Administrator',
        roleId: superAdminRoleId,
        isActive: true,
        // Doc 21 RC-007b — the temporary password must be changed on first login.
        mustChangePassword: true,
      })
      console.log(`[seed] Created super administrator ${adminEmail} (must change password)`)
    }

    console.log('')
    console.log('  Seed complete.')
    console.log('')
    console.log(`  Set this in your environment:   VENUE_ID=${venue.id}`)
    console.log('')
    console.log('  Not seeded, by design: courts, operating hours, pricing rules,')
    console.log('  CMS content. These are business values the venue owner supplies')
    console.log('  through the admin dashboard (OBD-004, Doc 22 §4.5).')
    console.log('')
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error('[seed] FAILED')
  console.error(error)
  process.exit(1)
})
