/**
 * Next.js instrumentation hook (enabled by `experimental.instrumentationHook`).
 *
 * Runs once per server process, on both application instances.
 *
 * Milestone 0 registers graceful shutdown only. Later milestones add here:
 *   - Sentry initialisation (Doc 22 M0-T11 — see src/lib/observability.ts)
 *   - the booking expiry cron job (Doc 22 M3-T13)
 *
 * IMPORTANT — the `process.env.NEXT_RUNTIME === 'nodejs'` check must WRAP the
 * imports rather than early-return above them. Next.js replaces that expression
 * with a literal at build time, so wrapping lets webpack eliminate the branch
 * entirely from the Edge bundle. With an early return the imports stay in the
 * module graph and the Edge build fails trying to resolve `fs`, `net` and
 * `stream` for `pg`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const [{ pool }, { registerGracefulShutdown }, { logger }] = await Promise.all([
      import('./lib/db/client'),
      import('./lib/lifecycle/shutdown'),
      import('./lib/logger'),
    ])

    registerGracefulShutdown(pool)
    // The instance identifier is already on every line via the logger's `base`.
    logger.info('Application instance started')
  }
}
