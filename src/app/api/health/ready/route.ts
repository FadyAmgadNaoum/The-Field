import { NextResponse } from 'next/server'

/**
 * READINESS — "can this instance safely receive traffic?"
 *
 * Doc 23 §1.5, Doc 24 §I.3. This is the authoritative UptimeRobot target and
 * the NGINX upstream health signal.
 *
 * Returns 503 when either:
 *   - the database is unreachable, or
 *   - the process is draining after SIGTERM (Doc 23 §13.5)
 *
 * NGINX removes the instance from rotation after two failed checks, so traffic
 * moves to the sibling instance before this one stops accepting work.
 *
 * The probe is deliberately `SELECT 1` and nothing more — never a table read,
 * never an aggregate (Doc 23 §1.5).
 *
 * Configuration and the database client are imported lazily so that a build or
 * a liveness check never opens a connection pool.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
  const timestamp = new Date().toISOString()

  const { isReady } = await import('@/lib/lifecycle/shutdown')
  if (!isReady()) {
    return NextResponse.json(
      { status: 'not_ready', database: 'unknown', reason: 'shutting_down', timestamp },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  let connected = false
  try {
    const { checkDatabaseConnection } = await import('@/lib/db/client')
    connected = (await checkDatabaseConnection()).connected
  } catch {
    // A configuration or import failure is itself a readiness failure. The
    // reason is logged server-side; the response stays generic.
    connected = false
  }

  return NextResponse.json(
    {
      status: connected ? 'ready' : 'not_ready',
      database: connected ? 'connected' : 'unavailable',
      timestamp,
    },
    { status: connected ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
