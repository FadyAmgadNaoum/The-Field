import { logger } from '../logger'
import { getShutdownDrainMs } from '../config'

/**
 * Graceful shutdown (Doc 23 §13.5, REL-M0-T03, Doc 24 §I.7).
 *
 * Sequence on SIGTERM (sent by PM2 before a reload, and on VPS shutdown):
 *   1. flip the readiness flag so /api/health/ready returns 503 immediately
 *   2. NGINX removes this upstream after 2 failed checks (~10s), routing all
 *      new traffic to the sibling instance
 *   3. drain: let in-flight requests finish
 *   4. close the database pool
 *   5. exit 0
 *
 * PM2 `kill_timeout: 35000` must exceed the drain window so the process is
 * never force-killed mid-transaction (Doc 23 §13.5).
 */

let shuttingDown = false

/** False once SIGTERM has been received. Read by the readiness endpoint. */
export function isReady(): boolean {
  return !shuttingDown
}

export function isShuttingDown(): boolean {
  return shuttingDown
}

/** Test-only reset. */
export function resetShutdownState(): void {
  shuttingDown = false
}

type PoolLike = { end: () => Promise<void> }

let registered = false

export function registerGracefulShutdown(pool: PoolLike): void {
  if (registered) return
  registered = true

  const handle = (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    const drainMs = getShutdownDrainMs()
    logger.info({ signal, drainMs }, 'Shutdown signal received — draining')

    void (async () => {
      try {
        if (drainMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, drainMs))
        }
        await pool.end()
        logger.info('Graceful shutdown complete')
      } catch (error) {
        logger.error({ err: error }, 'Error during graceful shutdown')
      } finally {
        process.exit(0)
      }
    })()
  }

  process.on('SIGTERM', handle)
  process.on('SIGINT', handle)
}
