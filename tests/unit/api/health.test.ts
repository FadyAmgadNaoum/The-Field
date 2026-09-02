import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Health and readiness contract (Doc 23 §1.5, Doc 24 §I.3).
 *
 * The database client is mocked so both branches can be exercised
 * deterministically. tests/integration/db/readiness.test.ts covers the same
 * endpoint against a real PostgreSQL.
 */

const checkDatabaseConnection = vi.fn()
const isReady = vi.fn()

vi.mock('@/lib/db/client', () => ({ checkDatabaseConnection }))
vi.mock('@/lib/lifecycle/shutdown', () => ({ isReady }))

beforeEach(() => {
  vi.clearAllMocks()
  isReady.mockReturnValue(true)
})

describe('GET /api/health/live', () => {
  it('returns 200 without touching the database', async () => {
    const { GET } = await import('@/app/api/health/live/route')
    const response = GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'alive' })
    // Liveness must never restart a healthy process because of a database blip.
    expect(checkDatabaseConnection).not.toHaveBeenCalled()
  })

  it('is never cached', async () => {
    const { GET } = await import('@/app/api/health/live/route')
    expect(GET().headers.get('Cache-Control')).toContain('no-store')
  })
})

describe('GET /api/health/ready', () => {
  it('returns 200 when the database answers', async () => {
    checkDatabaseConnection.mockResolvedValue({ connected: true, latencyMs: 3 })
    const { GET } = await import('@/app/api/health/ready/route')
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: 'ready',
      database: 'connected',
    })
  })

  it('returns 503 when the database is unavailable', async () => {
    checkDatabaseConnection.mockResolvedValue({ connected: false, latencyMs: null })
    const { GET } = await import('@/app/api/health/ready/route')
    const response = await GET()

    // NGINX removes this upstream after two failed checks (Doc 23 §1.6).
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      status: 'not_ready',
      database: 'unavailable',
    })
  })

  it('returns 503 while draining after SIGTERM', async () => {
    isReady.mockReturnValue(false)
    const { GET } = await import('@/app/api/health/ready/route')
    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ reason: 'shutting_down' })
    // Draining must not spend a connection on a probe.
    expect(checkDatabaseConnection).not.toHaveBeenCalled()
  })

  it('returns 503 rather than 500 when the probe itself throws', async () => {
    checkDatabaseConnection.mockRejectedValue(new Error('pool exhausted'))
    const { GET } = await import('@/app/api/health/ready/route')
    const response = await GET()

    expect(response.status).toBe(503)
  })

  it('never leaks infrastructure detail', async () => {
    checkDatabaseConnection.mockRejectedValue(
      new Error('connect ECONNREFUSED 10.0.0.5:5432 thefield_prod'),
    )
    const { GET } = await import('@/app/api/health/ready/route')
    const body = JSON.stringify(await (await GET()).json())

    expect(body).not.toContain('10.0.0.5')
    expect(body).not.toContain('thefield_prod')
    expect(body).not.toContain('ECONNREFUSED')
  })
})

describe('GET /api/health', () => {
  it('returns 200 and ok when healthy', async () => {
    checkDatabaseConnection.mockResolvedValue({ connected: true, latencyMs: 2 })
    const { GET } = await import('@/app/api/health/route')
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      database: 'connected',
    })
  })

  it('returns 503 and degraded when the database is down', async () => {
    checkDatabaseConnection.mockResolvedValue({ connected: false, latencyMs: null })
    const { GET } = await import('@/app/api/health/route')
    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ status: 'degraded' })
  })
})
