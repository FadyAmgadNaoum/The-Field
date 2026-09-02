import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { databaseConfig } from '../config'
import { logger } from '../logger'
import { captureException } from '../observability'
import * as schema from './schema'

/**
 * Database client (Doc 23 §2.4, REL-M0-T04, Doc 24 §C.1).
 *
 * Stack is node-postgres (`pg` v8) with `drizzle-orm/node-postgres`.
 * postgres.js is explicitly not used (Doc 24 §C.1).
 *
 * Pool sizing: 10 per instance x 2 instances = 20 connections, leaving
 * headroom on any managed plan with 60+ (Doc 23 §2.4). `connectionTimeoutMillis`
 * is short so an exhausted pool fails fast with a controlled 503 rather than
 * hanging (Doc 23 §2.5).
 *
 * ── LAZY CONSTRUCTION ────────────────────────────────────────────────────────
 * The pool is built on first use, not at import. `next build` imports every
 * route module to collect page data; constructing a pool then would demand a
 * valid DATABASE_URL to produce a build artefact, breaking the property that a
 * production build needs no secrets. `db` is a proxy so call sites are
 * unchanged.
 */

const { Pool } = pg

function createPool(): pg.Pool {
  const pool = new Pool({
    connectionString: databaseConfig.url,
    max: databaseConfig.poolMax,
    min: databaseConfig.poolMin,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Kill runaway queries rather than holding a connection indefinitely.
    statement_timeout: 30_000,
    query_timeout: 30_000,
    application_name: 'thefield',
  })

  // A pool-level error means an idle client dropped. Never allow this to become
  // an unhandled rejection that kills the process (Doc 23 §2.4).
  pool.on('error', (error) => {
    captureException(error, { component: 'pg.pool' })
  })

  return pool
}

/**
 * Reuse the pool across Next.js dev hot reloads. Without this, every edit opens
 * a new pool and the connection limit is exhausted within minutes.
 */
const globalForDb = globalThis as unknown as {
  __thefieldPool?: pg.Pool
  __thefieldDb?: NodePgDatabase<typeof schema>
}

/** The connection pool, created on first use. */
export function getPool(): pg.Pool {
  globalForDb.__thefieldPool ??= createPool()
  return globalForDb.__thefieldPool
}

function getDb(): NodePgDatabase<typeof schema> {
  globalForDb.__thefieldDb ??= drizzle(getPool(), { schema })
  return globalForDb.__thefieldDb
}

/**
 * Drizzle client.
 *
 * A proxy so that `import { db }` costs nothing until a query is actually run.
 * Methods are bound to the real instance, so drizzle's internal `this` works.
 */
export const db: NodePgDatabase<typeof schema> = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, property, receiver) {
    const instance = getDb()
    const value = Reflect.get(instance as object, property, receiver) as unknown
    return typeof value === 'function' ? value.bind(instance) : value
  },
  has(_target, property) {
    return Reflect.has(getDb() as object, property)
  },
})

export interface DatabaseHealth {
  connected: boolean
  latencyMs: number | null
}

/**
 * Lightweight connectivity probe for the readiness endpoint.
 *
 * Doc 23 §1.5: this must stay cheap. `SELECT 1` only — never a table read, an
 * aggregate, or anything that touches booking data.
 */
export async function checkDatabaseConnection(): Promise<DatabaseHealth> {
  const startedAt = Date.now()
  try {
    await db.execute(sql`SELECT 1`)
    return { connected: true, latencyMs: Date.now() - startedAt }
  } catch (error) {
    // A database outage is an expected operational condition, and this probe
    // runs every few seconds. Log the diagnosis, not a multi-kilobyte stack on
    // every attempt — unexpected failures elsewhere still capture full detail
    // through captureException.
    const { code, message } = error as { code?: string; message?: string }
    logger.error({ component: 'db.healthcheck', code, reason: message }, 'Database probe failed')
    return { connected: false, latencyMs: null }
  }
}

export { schema }
