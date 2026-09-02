import type pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { withApiHandler } from '@/lib/api/handler'
import { apiSuccess } from '@/lib/api/response'
import { createClient, createFixtures, insertBooking, type Fixtures } from '../helpers/database'

/**
 * End-to-end mapping: PostgreSQL exclusion violation -> HTTP 409.
 *
 * Doc 22 §8.4 requires that when the database refuses an overlapping approved
 * booking, the caller receives HTTP 409 BOOKING_CONFLICT — never a 500, and
 * never a message containing SQL.
 *
 * This exercises the REAL error object PostgreSQL produces, through the REAL
 * route wrapper. A hand-built `{ code: '23P01' }` fixture would not prove that
 * `pg` surfaces the code where the mapper looks for it.
 *
 * No booking endpoint exists in Milestone 0 — this validates the error pipeline
 * that Milestone 3/4 endpoints will sit on, not a business route.
 */

const DATE = '2026-09-10'

let client: pg.Client
let fixtures: Fixtures

beforeAll(async () => {
  client = await createClient()
})

afterAll(async () => {
  await client?.end()
})

beforeEach(async () => {
  await client.query('BEGIN')
  fixtures = await createFixtures(client)
})

afterEach(async () => {
  await client.query('ROLLBACK')
})

describe('exclusion violation surfaces as HTTP 409', () => {
  it('produces SQLSTATE 23P01 from a real overlapping insert', async () => {
    await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '19:00',
      endTime: '20:00',
      status: 'approved',
    })

    const caught = await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '19:00',
      endTime: '20:00',
      status: 'approved',
    }).catch((error: unknown) => error)

    expect((caught as { code?: string }).code).toBe('23P01')
  })

  it('maps that real error to a 409 BOOKING_CONFLICT envelope', async () => {
    await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '19:00',
      endTime: '20:00',
      status: 'approved',
    })

    // A route that performs the conflicting write and lets the error propagate,
    // exactly as a booking approval handler will.
    const handler = withApiHandler(async (_request, { requestId }) => {
      await insertBooking(client, fixtures, {
        courtId: fixtures.courtId,
        date: DATE,
        startTime: '19:00',
        endTime: '20:00',
        status: 'approved',
      })
      return apiSuccess({ approved: true }, { requestId })
    })

    const response = await handler(new Request('https://thefield.eg/api/v1/test'))
    const body = (await response.json()) as {
      success: boolean
      error: { code: string; message: string }
    }

    expect(response.status).toBe(409)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('BOOKING_CONFLICT')
  })

  it('leaks no SQL, constraint name or table name to the client', async () => {
    await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '19:00',
      endTime: '20:00',
      status: 'approved',
    })

    const handler = withApiHandler(async (_request, { requestId }) => {
      await insertBooking(client, fixtures, {
        courtId: fixtures.courtId,
        date: DATE,
        startTime: '19:00',
        endTime: '20:00',
        status: 'approved',
      })
      return apiSuccess({}, { requestId })
    })

    const raw = JSON.stringify(await (await handler(new Request('https://thefield.eg/x'))).json())

    expect(raw).not.toContain('no_overlapping_approved_bookings')
    expect(raw).not.toContain('exclusion')
    expect(raw).not.toContain('INSERT')
    expect(raw).not.toContain('bookings')
    expect(raw).not.toContain('23P01')
  })

  it('still carries a request id for log correlation', async () => {
    await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '19:00',
      endTime: '20:00',
      status: 'approved',
    })

    const handler = withApiHandler(async (_request, { requestId }) => {
      await insertBooking(client, fixtures, {
        courtId: fixtures.courtId,
        date: DATE,
        startTime: '19:00',
        endTime: '20:00',
        status: 'approved',
      })
      return apiSuccess({}, { requestId })
    })

    const response = await handler(new Request('https://thefield.eg/x'))
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })
})
