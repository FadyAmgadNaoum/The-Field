import { NextResponse } from 'next/server'

/**
 * LIVENESS — "is this process running and responsive?"
 *
 * Doc 23 §1.5. No database call, no external call, no configuration read.
 * Used by PM2 and as a cheap process check. A liveness probe that touches the
 * database would restart a healthy process during a database blip.
 *
 * Exposes no infrastructure detail (Doc 23 §1.5 security note).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function GET(): NextResponse {
  return NextResponse.json(
    { status: 'alive', timestamp: new Date().toISOString() },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
