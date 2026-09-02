import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Unit test project (Doc 22 M0-T03, Doc 24 §O).
 *
 * Fast, no database, no network. Integration tests live in
 * vitest.integration.config.ts and require a running PostgreSQL.
 */
export default defineConfig({
  test: {
    name: 'unit',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/setup/unit-env.ts'],
    globals: false,
    reporters: 'default',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
