import { NextResponse } from 'next/server'

/**
 * Combined health check — liveness AND readiness.
 *
 * Retained for backward compatibility with the UptimeRobot configuration in
 * Doc 16 §3.1 and the contract in Doc 11 §5.13. New monitors should target
 * `/api/health/ready` instead (Doc 23 §1.5, Doc 24 §I.3).
 *
 * Returns no stack traces, connection strings or server names (Doc 23 §1.5).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
  const timestamp = new Date().toISOString()

  const { isReady } = await import('@/lib/lifecycle/shutdown')
  const draining = !isReady()

  let connected = false
  if (!draining) {
    try {
      const { checkDatabaseConnection } = await import('@/lib/db/client')
      connected = (await checkDatabaseConnection()).connected
    } catch {
      connected = false
    }
  }

  const healthy = connected && !draining

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      database: connected ? 'connected' : 'unavailable',
      timestamp,
      version: process.env.npm_package_version ?? 'unknown',
      uptime: Math.round(process.uptime()),
    },
    { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
