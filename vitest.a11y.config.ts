import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Accessibility audit project (Doc 22 M2-T11, Doc 23 Gate M2).
 *
 * Audits the REAL server-rendered HTML of every public page with axe-core, so
 * it needs a running application:
 *
 *   npm run dev
 *   npm run test:a11y
 *
 * Kept as a separate project rather than folded into the unit suite because it
 * has an external prerequisite, exactly like the integration project's database.
 */
export default defineConfig({
  test: {
    name: 'a11y',
    environment: 'node',
    include: ['tests/a11y/**/*.test.ts'],
    setupFiles: ['tests/setup/unit-env.ts'],
    globals: false,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: 'default',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
