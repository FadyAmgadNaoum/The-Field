import { parseServerEnv, type ServerEnv } from './env'

/**
 * Server configuration (Doc 22 §7.4, Doc 24 §I.4).
 *
 * Evaluated at module load: importing this module in a misconfigured
 * environment throws immediately, before any request is served.
 *
 * This module is server-only. It holds secrets and must never be imported from
 * a client component or from middleware (which runs on the Edge runtime).
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'src/lib/config must never be imported into client-side code — it reads server secrets.',
  )
}

export const env: ServerEnv = parseServerEnv(process.env)

export const isProduction = env.NODE_ENV === 'production'
export const isDevelopment = env.NODE_ENV === 'development'
export const isTest = env.NODE_ENV === 'test'

/**
 * Venue scope. Every service call that reads or writes venue-owned data takes
 * this id explicitly. It is never read from a request parameter or body
 * (Doc 10 §4.4, Doc 24 §M item 16).
 */
export const venueConfig = {
  id: env.VENUE_ID,
  slug: env.VENUE_SLUG,
} as const

export const databaseConfig = {
  url: env.DATABASE_URL,
  migrationUrl: env.DATABASE_MIGRATION_URL,
  poolMax: env.DB_POOL_MAX,
  poolMin: env.DB_POOL_MIN,
} as const

export const bookingConfig = {
  /** OBD-002 — supplied by the venue owner, never defaulted (Doc 24 §I.4). */
  expiryMinutes: env.BOOKING_EXPIRY_MINUTES,
  expiryJobIntervalMinutes: env.BOOKING_EXPIRY_JOB_INTERVAL_MINUTES,
} as const

export const storageConfig = {
  provider: env.STORAGE_PROVIDER,
} as const

/**
 * How long to keep serving in-flight requests after SIGTERM before closing the
 * pool. Production drains for 30s to pair with PM2 `kill_timeout: 35000`
 * (Doc 23 §13.5). Development exits immediately so restarts stay fast.
 */
export const shutdownDrainMs = (() => {
  const explicit = env.SHUTDOWN_DRAIN_MS
  if (explicit !== undefined && explicit !== '' && /^\d+$/.test(explicit)) {
    return Number.parseInt(explicit, 10)
  }
  return isProduction ? 30_000 : 0
})()

export { EnvironmentValidationError } from './env'
