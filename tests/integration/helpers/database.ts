import pg from 'pg'

/**
 * Integration test database helper.
 *
 * Every test runs inside a transaction that is rolled back afterwards, so the
 * database is left exactly as it was found. The exclusion constraint is checked
 * at statement time, so wrapping in a transaction does not weaken any assertion.
 */

export function connectionString(): string {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

export async function createClient(url = connectionString()): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, application_name: 'thefield-tests' })
  await client.connect()
  return client
}

export interface Fixtures {
  venueId: string
  courtId: string
  otherCourtId: string
  customerAccountId: string
}

/**
 * Minimal rows needed to insert a booking. Created inside the caller's
 * transaction, so they disappear on rollback.
 */
export async function createFixtures(client: pg.Client): Promise<Fixtures> {
  const venue = await client.query<{ id: string }>(
    `INSERT INTO venues (slug, name, timezone, currency, booking_ref_prefix)
     VALUES ($1, 'Test Venue', 'Africa/Cairo', 'EGP', 'TF')
     RETURNING id`,
    [`test-venue-${Date.now()}-${Math.round(Math.random() * 1e6)}`],
  )
  const venueId = venue.rows[0]!.id

  const court = await client.query<{ id: string }>(
    `INSERT INTO courts (venue_id, name) VALUES ($1, 'Court 1') RETURNING id`,
    [venueId],
  )
  const otherCourt = await client.query<{ id: string }>(
    `INSERT INTO courts (venue_id, name) VALUES ($1, 'Court 2') RETURNING id`,
    [venueId],
  )

  const customer = await client.query<{ id: string }>(
    `INSERT INTO customer_accounts (email, password_hash, full_name)
     VALUES ($1, 'not-a-real-hash', 'Test Customer')
     RETURNING id`,
    [`test-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`],
  )

  return {
    venueId,
    courtId: court.rows[0]!.id,
    otherCourtId: otherCourt.rows[0]!.id,
    customerAccountId: customer.rows[0]!.id,
  }
}

export interface BookingInput {
  reference?: string
  courtId: string
  date: string
  startTime: string
  endTime: string
  status: string
}

let referenceCounter = 0

export async function insertBooking(
  client: pg.Client,
  fixtures: Fixtures,
  input: BookingInput,
): Promise<string> {
  referenceCounter += 1
  const reference = input.reference ?? `TF-TEST-${referenceCounter.toString().padStart(4, '0')}`

  const result = await client.query<{ id: string }>(
    `INSERT INTO bookings (
       booking_reference, venue_id, court_id, customer_account_id,
       booking_date, start_time, end_time, price_amount, currency, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 350.00, 'EGP', $8::booking_status)
     RETURNING id`,
    [
      reference,
      fixtures.venueId,
      input.courtId,
      fixtures.customerAccountId,
      input.date,
      input.startTime,
      input.endTime,
      input.status,
    ],
  )

  return result.rows[0]!.id
}

/** PostgreSQL error code carried on a thrown query error. */
export function sqlState(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code?: string }).code
  }
  return undefined
}
