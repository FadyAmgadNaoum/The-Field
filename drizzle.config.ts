import './src/lib/config/load-env'
import { defineConfig } from 'drizzle-kit'

/**
 * Drizzle Kit configuration (Doc 22 M0-T04).
 *
 * Migrations are generated from the schema in src/db/schema and applied with
 * `npm run db:migrate`. The generated column and exclusion constraint are NOT
 * managed here — they are raw SQL in src/db/migrations/raw (Doc 22 §4.3,
 * Doc 24 §D.2) and applied by `npm run db:migrate:raw`.
 *
 * Schema changes use DATABASE_MIGRATION_URL (migration_user), never
 * DATABASE_URL (app_user) — Doc 22 §4.4.
 */
export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
})
