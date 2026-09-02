import '../../src/lib/config/load-env'

/**
 * Integration test environment.
 *
 * Requires a real PostgreSQL 16 with migrations applied:
 *
 *   docker compose up -d
 *   npm run db:migrate && npm run db:migrate:raw
 *
 * Fails loudly rather than skipping. A green integration run must mean the
 * database guarantees were actually exercised (Doc 24 §J.1).
 */
if (!process.env.DATABASE_URL && !process.env.DATABASE_MIGRATION_URL) {
  throw new Error(
    'Integration tests require DATABASE_URL (or DATABASE_MIGRATION_URL).\n' +
      'Start the local database first:  docker compose up -d\n' +
      'Then apply migrations:           npm run db:migrate && npm run db:migrate:raw',
  )
}

// Next.js types NODE_ENV as readonly; tests legitimately need to set it.
const mutableEnv = process.env as Record<string, string | undefined>
mutableEnv.NODE_ENV ??= 'test'

process.env.LOG_LEVEL ??= 'silent'
