/**
 * Next.js instrumentation hook (enabled by `experimental.instrumentationHook`).
 *
 * Runs once per server process, on both application instances.
 *
 * THIS is where fail-fast lives. Configuration is validated lazily so that
 * importing a module — which `next build` does for every route — needs no
 * secrets. Calling `getEnv()` here restores the guarantee that a misconfigured
 * deployment dies at startup rather than on the first request
 * (Doc 22 M0-T07, Doc 23 REL-M1-T04, Doc 24 §I.4).
 *
 * Later milestones add the booking expiry cron job here (Doc 22 M3-T13).
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
    const [{ getEnv }, { getPool }, { registerGracefulShutdown }, { logger }] = await Promise.all([
      import('./lib/config'),
      import('./lib/db/client'),
      import('./lib/lifecycle/shutdown'),
      import('./lib/logger'),
    ])

    // Throws with a list of every problem if anything required is missing.
    getEnv()

    registerGracefulShutdown(getPool())
    // The instance identifier is already on every line via the logger's `base`.
    logger.info('Application instance started')
  }
}
