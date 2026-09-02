import { parseServerEnv, type ServerEnv } from './env'

/**
 * Server configuration (Doc 22 §7.4, Doc 24 §I.4).
 *
 * ── WHY THIS IS LAZY ─────────────────────────────────────────────────────────
 * Validation is memoised behind `getEnv()` rather than run at module load.
 *
 * `next build` imports every route module to collect page data. If importing a
 * module demanded a complete, valid runtime environment, the build would need
 * production secrets — and Milestone 0 verified the opposite property: the
 * production build succeeds with no environment file present at all. Keeping
 * import side-effect-free preserves that.
 *
 * Fail-fast is NOT lost. `src/instrumentation.ts` calls `getEnv()` when the
 * server process starts, so a misconfigured deployment still dies immediately
 * and visibly rather than on the first request (Doc 23 REL-M1-T04).
 *
 * The exported objects use getters, so call sites read `venueConfig.id` exactly
 * as before and validation happens on first genuine use.
 *
 * This module is server-only. It holds secrets and must never be imported from
 * a client component or from middleware (which runs on the Edge runtime).
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'src/lib/config must never be imported into client-side code — it reads server secrets.',
  )
}

let cachedEnv: ServerEnv | undefined

/** Parse and cache the environment. Throws on the first call if invalid. */
export function getEnv(): ServerEnv {
  cachedEnv ??= parseServerEnv(process.env)
  return cachedEnv
}

/** Test helper — forces the next `getEnv()` to re-read `process.env`. */
export function resetEnvCache(): void {
  cachedEnv = undefined
}

export const isProduction = process.env.NODE_ENV === 'production'
export const isDevelopment = process.env.NODE_ENV === 'development'
export const isTest = process.env.NODE_ENV === 'test'

/**
 * Venue scope. Every service call that reads or writes venue-owned data takes
 * this id explicitly. It is never read from a request parameter or body
 * (Doc 10 §4.4, Doc 24 §M item 16).
 */
export const venueConfig = {
  get id(): string {
    return getEnv().VENUE_ID
  },
  get slug(): string {
    return getEnv().VENUE_SLUG
  },
}

export const databaseConfig = {
  get url(): string {
    return getEnv().DATABASE_URL
  },
  get migrationUrl(): string | undefined {
    return getEnv().DATABASE_MIGRATION_URL
  },
  get poolMax(): number {
    return getEnv().DB_POOL_MAX
  },
  get poolMin(): number {
    return getEnv().DB_POOL_MIN
  },
}

export const bookingConfig = {
  /** OBD-002 — supplied by the venue owner, never defaulted (Doc 24 §I.4). */
  get expiryMinutes(): number {
    return getEnv().BOOKING_EXPIRY_MINUTES
  },
  get expiryJobIntervalMinutes(): number {
    return getEnv().BOOKING_EXPIRY_JOB_INTERVAL_MINUTES
  },
}

export const storageConfig = {
  get provider(): 's3' | 'local' {
    return getEnv().STORAGE_PROVIDER
  },
}

/**
 * Google Sign-In (Doc 24 §E.2).
 *
 * `isConfigured` is false when credentials are absent, which is permitted
 * outside production. The OAuth routes then return a controlled 503 rather than
 * failing in an ambiguous way.
 *
 * The redirect URI is a single fixed value. It is never derived from a request,
 * so a callback cannot be pointed at another origin (Doc 23 §16.4).
 */
export const googleConfig = {
  get clientId(): string | undefined {
    return getEnv().GOOGLE_CLIENT_ID
  },
  get clientSecret(): string | undefined {
    return getEnv().GOOGLE_CLIENT_SECRET
  },
  get redirectUri(): string | undefined {
    return getEnv().GOOGLE_REDIRECT_URI
  },
  get isConfigured(): boolean {
    const env = getEnv()
    return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI)
  },
}

/** Session secret. Identical across instances so sessions survive instance switching. */
export function getSessionSecret(): string {
  return getEnv().SESSION_SECRET
}

/**
 * How long to keep serving in-flight requests after SIGTERM before closing the
 * pool. Production drains for 30s to pair with PM2 `kill_timeout: 35000`
 * (Doc 23 §13.5). Development exits immediately so restarts stay fast.
 */
export function getShutdownDrainMs(): number {
  const explicit = getEnv().SHUTDOWN_DRAIN_MS
  if (explicit !== undefined && explicit !== '' && /^\d+$/.test(explicit)) {
    return Number.parseInt(explicit, 10)
  }
  return isProduction ? 30_000 : 0
}

export { EnvironmentValidationError } from './env'
