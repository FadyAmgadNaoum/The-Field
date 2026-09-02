import { config } from 'dotenv'

/**
 * Environment file loading for standalone scripts.
 *
 * Next.js loads `.env.local` automatically, but `tsx`-run scripts (migrate,
 * migrate:raw, seed), drizzle-kit and the integration test suite do not.
 * Importing plain `dotenv/config` reads only `.env`, so the documented setup in
 * the README — which creates `.env.local` — would leave every script without a
 * DATABASE_URL.
 *
 * Precedence matches Next.js: `.env.local` overrides `.env`, and a variable
 * already present in the real environment always wins (dotenv does not
 * overwrite existing values). That keeps CI and production, which inject
 * variables directly, unaffected by any file on disk.
 *
 * Import this for its side effect, before anything that reads process.env:
 *
 *   import '@/lib/config/load-env'
 */
config({ path: '.env.local' })
config({ path: '.env' })
