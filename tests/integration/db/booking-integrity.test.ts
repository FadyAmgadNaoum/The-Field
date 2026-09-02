import type pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createClient,
  createFixtures,
  insertBooking,
  sqlState,
  type Fixtures,
} from '../helpers/database'

/**
 * THE double-booking guarantee (Doc 05 §4.9, Doc 21 RC-001, Doc 24 §D.2, §M item 1).
 *
 * These assertions verify the constraint at the database level, bypassing all
 * application code — which is the point. Doc 19 AC-DATA-001 requires that a
 * direct SQL INSERT of an overlapping approved booking is rejected with
 * SQLSTATE 23P01.
 *
 * Each test runs in a transaction that is rolled back, so nothing persists.
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

describe('overlapping approved bookings are impossible', () => {
  it('rejects an identical approved slot with SQLSTATE 23P01', async () => {
    await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '19:00',
      endTime: '20:00',
      status: 'approved',
    })

    const attempt = insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '19:00',
      endTime: '20:00',
      status: 'approved',
    })

    await expect(attempt).rejects.toSatisfy(
      (error: unknown) => sqlState(error) === '23P01',
      'expected exclusion_violation (23P01)',
    )
  })

  it('rejects a partially overlapping approved slot', async () => {
    await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '19:00',
      endTime: '21:00',
      status: 'approved',
    })

    const attempt = insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '20:00',
      endTime: '22:00',
      status: 'approved',
    })

    await expect(attempt).rejects.toSatisfy((error: unknown) => sqlState(error) === '23P01')
  })

  it('rejects a contained approved slot', async () => {
    await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '18:00',
      endTime: '22:00',
      status: 'approved',
    })

    const attempt = insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '19:00',
      endTime: '20:00',
      status: 'approved',
    })

    await expect(attempt).rejects.toSatisfy((error: unknown) => sqlState(error) === '23P01')
  })
})

describe('bookings that must remain allowed', () => {
  it('allows adjacent slots — 18:00-19:00 and 19:00-20:00 do not overlap', async () => {
    await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '18:00',
      endTime: '19:00',
      status: 'approved',
    })

    await expect(
      insertBooking(client, fixtures, {
        courtId: fixtures.courtId,
        date: DATE,
        startTime: '19:00',
        endTime: '20:00',
        status: 'approved',
      }),
    ).resolves.toBeTruthy()
  })

  it('allows the same slot on a different court', async () => {
    await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '19:00',
      endTime: '20:00',
      status: 'approved',
    })

    await expect(
      insertBooking(client, fixtures, {
        courtId: fixtures.otherCourtId,
        date: DATE,
        startTime: '19:00',
        endTime: '20:00',
        status: 'approved',
      }),
    ).resolves.toBeTruthy()
  })

  it('allows the same slot on a different date', async () => {
    await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '19:00',
      endTime: '20:00',
      status: 'approved',
    })

    await expect(
      insertBooking(client, fixtures, {
        courtId: fixtures.courtId,
        date: '2026-09-11',
        startTime: '19:00',
        endTime: '20:00',
        status: 'approved',
      }),
    ).resolves.toBeTruthy()
  })
})

describe('constraint scope is approved bookings only', () => {
  it.each(['pending', 'payment_submitted', 'under_review'])(
    'allows two %s bookings for the same slot — the documented accepted race',
    async (status) => {
      // Doc 06 §5 / Doc 21 RC-004: both hold the slot as a soft hold, and only
      // one of them can ever reach `approved`.
      await insertBooking(client, fixtures, {
        courtId: fixtures.courtId,
        date: DATE,
        startTime: '19:00',
        endTime: '20:00',
        status,
      })

      await expect(
        insertBooking(client, fixtures, {
          courtId: fixtures.courtId,
          date: DATE,
          startTime: '19:00',
          endTime: '20:00',
          status,
        }),
      ).resolves.toBeTruthy()
    },
  )

  it.each(['rejected', 'cancelled', 'expired'])(
    'a %s booking releases its slot for a new approved booking',
    async (status) => {
      await insertBooking(client, fixtures, {
        courtId: fixtures.courtId,
        date: DATE,
        startTime: '19:00',
        endTime: '20:00',
        status,
      })

      await expect(
        insertBooking(client, fixtures, {
          courtId: fixtures.courtId,
          date: DATE,
          startTime: '19:00',
          endTime: '20:00',
          status: 'approved',
        }),
      ).resolves.toBeTruthy()
    },
  )

  it('blocks approving a second booking once the first is approved', async () => {
    const first = await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '19:00',
      endTime: '20:00',
      status: 'pending',
    })
    const second = await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '19:00',
      endTime: '20:00',
      status: 'pending',
    })

    await client.query(`UPDATE bookings SET status = 'approved' WHERE id = $1`, [first])

    // This is the two-admin race from Doc 06 §9 — the database is the backstop.
    await expect(
      client.query(`UPDATE bookings SET status = 'approved' WHERE id = $1`, [second]),
    ).rejects.toSatisfy((error: unknown) => sqlState(error) === '23P01')
  })
})

describe('midnight boundary — Doc 24 §F.4', () => {
  it('accepts a 23:00-24:00 slot', async () => {
    await expect(
      insertBooking(client, fixtures, {
        courtId: fixtures.courtId,
        date: DATE,
        startTime: '23:00',
        endTime: '24:00',
        status: 'approved',
      }),
    ).resolves.toBeTruthy()
  })

  it('computes the range of a 23:00-24:00 slot as ending at next-day midnight', async () => {
    const id = await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '23:00',
      endTime: '24:00',
      status: 'approved',
    })

    const result = await client.query<{ upper: string; lower: string }>(
      `SELECT lower(booking_range)::text AS lower, upper(booking_range)::text AS upper
       FROM bookings WHERE id = $1`,
      [id],
    )

    expect(result.rows[0]?.lower).toContain('2026-09-10 23:00:00')
    expect(result.rows[0]?.upper).toContain('2026-09-11 00:00:00')
  })

  it('does not treat 23:00-24:00 as overlapping 22:00-23:00', async () => {
    await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '22:00',
      endTime: '23:00',
      status: 'approved',
    })

    await expect(
      insertBooking(client, fixtures, {
        courtId: fixtures.courtId,
        date: DATE,
        startTime: '23:00',
        endTime: '24:00',
        status: 'approved',
      }),
    ).resolves.toBeTruthy()
  })

  it('does not treat 23:00-24:00 as overlapping the next morning 00:00-01:00', async () => {
    await insertBooking(client, fixtures, {
      courtId: fixtures.courtId,
      date: DATE,
      startTime: '23:00',
      endTime: '24:00',
      status: 'approved',
    })

    await expect(
      insertBooking(client, fixtures, {
        courtId: fixtures.courtId,
        date: '2026-09-11',
        startTime: '00:00',
        endTime: '01:00',
        status: 'approved',
      }),
    ).resolves.toBeTruthy()
  })
})
