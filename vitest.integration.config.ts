import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Integration test project (Doc 22 M0-T03, Doc 24 §O).
 *
 * Requires a real PostgreSQL 16 instance reachable via DATABASE_URL, with
 * migrations already applied:
 *
 *   docker compose up -d
 *   npm run db:migrate && npm run db:migrate:raw
 *   npm run test:integration
 *
 * These tests exercise database-level guarantees (the exclusion constraint,
 * generated column, privilege REVOKEs) that cannot be verified without a real
 * server. They fail loudly rather than silently skipping when no database is
 * reachable — a green run must mean the guarantees were actually checked.
 */
export default defineConfig({
  test: {
    name: 'integration',
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup/integration-env.ts'],
    globals: false,
    // Database tests must not run concurrently against shared tables.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: 'default',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
