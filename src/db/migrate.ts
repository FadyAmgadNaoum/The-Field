import '../lib/config/load-env'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { parseDatabaseEnv } from '../lib/config/env'

/**
 * Apply Drizzle-generated migrations (Doc 22 M0-T04).
 *
 * Runs as migration_user, never as app_user (Doc 22 §4.4). Idempotent: Drizzle
 * records applied migrations in `drizzle.__drizzle_migrations`.
 *
 * The generated column, exclusion constraint, partial indexes, CHECK
 * constraints and role privileges are NOT handled here — run
 * `npm run db:migrate:raw` immediately afterwards.
 */
async function main(): Promise<void> {
  const env = parseDatabaseEnv(process.env)
  const connectionString = env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL

  if (!env.DATABASE_MIGRATION_URL) {
    console.warn(
      '[migrate] DATABASE_MIGRATION_URL is not set — falling back to DATABASE_URL.\n' +
        '          Production must use a dedicated migration role (Doc 22 §4.4).',
    )
  }

  const client = new pg.Client({ connectionString, application_name: 'thefield-migrate' })
  await client.connect()

  try {
    const db = drizzle(client)
    console.log('[migrate] Applying Drizzle migrations...')
    await migrate(db, { migrationsFolder: 'src/db/migrations' })
    console.log('[migrate] Done.')
    console.log('[migrate] Next: npm run db:migrate:raw')
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error('[migrate] FAILED')
  console.error(error)
  process.exit(1)
})
