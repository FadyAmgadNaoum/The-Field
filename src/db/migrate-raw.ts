import '../lib/config/load-env'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import pg from 'pg'
import { parseDatabaseEnv } from '../lib/config/env'

/**
 * Apply the raw SQL migrations that Drizzle cannot express (Doc 22 §4.3,
 * Doc 24 §D.2): the `booking_range` generated column, the exclusion constraint,
 * partial indexes, CHECK constraints, and role privileges.
 *
 * Doc 22 M0-T05 specifies a bash script invoking `psql`. This TypeScript runner
 * is used instead because it needs no psql binary on the machine, behaves
 * identically on Windows, Linux and CI, and can wrap each file in a transaction
 * so a partial application cannot be left behind. Recorded as an implementation
 * detail in the Milestone 0 report.
 *
 * Every file is idempotent, so this runs on every deployment (Doc 23 §13.6).
 */

const RAW_DIR = join('src', 'db', 'migrations', 'raw')

async function main(): Promise<void> {
  const env = parseDatabaseEnv(process.env)
  const connectionString = env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL

  const entries = await readdir(RAW_DIR)
  const files = entries.filter((name) => name.endsWith('.sql')).sort()

  if (files.length === 0) {
    console.warn(`[migrate:raw] No .sql files found in ${RAW_DIR}`)
    return
  }

  const client = new pg.Client({ connectionString, application_name: 'thefield-migrate-raw' })
  await client.connect()

  // Surface RAISE NOTICE output from the DO blocks (privilege reporting).
  client.on('notice', (notice) => {
    if (notice.message) console.log(`[migrate:raw]   ${notice.message}`)
  })

  try {
    for (const file of files) {
      const sql = await readFile(join(RAW_DIR, file), 'utf8')
      console.log(`[migrate:raw] Applying ${file}`)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw new Error(`${file} failed: ${(error as Error).message}`, { cause: error })
      }
    }
    console.log(`[migrate:raw] Applied ${files.length} file(s).`)
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error('[migrate:raw] FAILED')
  console.error(error)
  process.exit(1)
})
