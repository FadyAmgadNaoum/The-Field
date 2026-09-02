import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => {
  const { getTestCookieJar } = await import('../helpers/cookie-jar')
  return { cookies: () => getTestCookieJar() }
})

import { establishCustomerSession } from '@/lib/auth/customer-session'
import { jsonPost, primeCsrf, readEnvelope, uniqueIp } from '../helpers/auth-requests'
import { resetTestCookieJar } from '../helpers/cookie-jar'
import { cleanupAccounts, createTestCustomer, trackCustomer } from '../helpers/accounts'
import {
  cleanupCmsFixtures,
  createTestBooking,
  createTestCourt,
  createTestPaymentRecord,
  requireVenue,
} from '../helpers/cms-fixtures'

/**
 * Booking status lookup (Doc 22 M2-T10, Doc 10 §3.5, Doc 11 §4.4, Doc 13 T-004).
 *
 * ── WHAT THIS SUITE IS FOR ───────────────────────────────────────────────────
 * This endpoint is the one place in Milestone 2 where a customer asks the
 * server about a specific record by an identifier they hold. That makes it the
 * milestone's IDOR and enumeration surface, and the tests are written against
 * that rather than against the happy path alone:
 *
 *  - ownership comes from the SESSION, never from the request (Doc 24 §E.1)
 *  - another account's reference is indistinguishable from a missing one
 *  - the response carries no internal identifier and no admin-only field
 *
 * The route handler is driven directly against the real database with real
 * iron-session encryption; the cookie jar stands in for a browser.
 */

let referenceCounter = 0

function nextReference(): string {
  referenceCounter += 1
  return `TF-20260910-T${referenceCounter.toString().padStart(3, '0')}`
}

async function lookup(body: unknown, ip = uniqueIp()) {
  const { POST } = await import('@/app/api/v1/booking-status/route')
  return POST(jsonPost(body, { ip, url: 'https://thefield.eg/api/v1/booking-status' }))
}

beforeEach(async () => {
  resetTestCookieJar()
  await primeCsrf()
})

afterAll(async () => {
  await cleanupCmsFixtures()
  await cleanupAccounts()
})

describe('authentication', () => {
  it('rejects an unauthenticated request with 401', async () => {
    // Doc 24 §E.1: there is no anonymous reference lookup, and no phone
    // fallback. A booking reference is not a credential.
    const response = await lookup({ reference: nextReference() })

    expect(response.status).toBe(401)
    const body = await readEnvelope(response)
    expect(body.error?.code).toBe('UNAUTHORIZED')
  })

  it('does not reveal whether the reference exists when unauthenticated', async () => {
    await requireVenue()
    const owner = trackCustomer(await createTestCustomer())
    const court = await createTestCourt()
    const real = nextReference()
    await createTestBooking({
      courtId: court.id,
      customerAccountId: owner.id,
      reference: real,
    })

    const forReal = await lookup({ reference: real })
    const forFake = await lookup({ reference: nextReference() })

    // Identical treatment: the 401 fires before anything touches the table.
    expect(forReal.status).toBe(401)
    expect(forFake.status).toBe(401)
  })
})

describe('ownership', () => {
  it('returns the booking to the account that owns it', async () => {
    await requireVenue()
    const owner = trackCustomer(await createTestCustomer())
    const court = await createTestCourt()
    const reference = nextReference()

    await createTestBooking({
      courtId: court.id,
      customerAccountId: owner.id,
      reference,
      status: 'pending',
    })

    await establishCustomerSession({ id: owner.id, email: owner.email })

    const response = await lookup({ reference })
    expect(response.status).toBe(200)

    const body = await readEnvelope<{
      booking: {
        reference: string
        status: string
        courtName: string
        date: string
        startTime: string
        endTime: string
        price: { amount: string; currency: string }
        awaitingPaymentProof: boolean
      }
    }>(response)

    expect(body.data?.booking.reference).toBe(reference)
    expect(body.data?.booking.status).toBe('pending')
    expect(body.data?.booking.courtName).toBe(court.name)
    expect(body.data?.booking.date).toBe('2026-09-10')
    expect(body.data?.booking.startTime).toBe('19:00')
    expect(body.data?.booking.endTime).toBe('20:00')
    expect(body.data?.booking.price.amount).toBe('350.00')
    expect(body.data?.booking.price.currency).toBe('EGP')
  })

  it('answers 404 for a reference belonging to a different account', async () => {
    // THE IDOR TEST. Two real accounts, one real booking. The non-owner must
    // receive exactly what they would receive for a reference that does not
    // exist — same status, same code (Doc 13 T-004, Doc 10 §3.5).
    await requireVenue()
    const owner = trackCustomer(await createTestCustomer())
    const intruder = trackCustomer(await createTestCustomer())
    const court = await createTestCourt()
    const reference = nextReference()

    await createTestBooking({ courtId: court.id, customerAccountId: owner.id, reference })

    await establishCustomerSession({ id: intruder.id, email: intruder.email })

    const stolen = await lookup({ reference })
    const missing = await lookup({ reference: nextReference() })

    expect(stolen.status).toBe(404)
    expect(missing.status).toBe(404)

    const stolenBody = await readEnvelope(stolen)
    const missingBody = await readEnvelope(missing)

    expect(stolenBody.error?.code).toBe('NOT_FOUND')
    // Byte-identical messages: the response cannot be used as an oracle.
    expect(stolenBody.error?.message).toBe(missingBody.error?.message)
  })

  it('ignores a customerAccountId supplied in the request body', async () => {
    // Doc 24 §E.1 and §16.4: a customer id in a request body has no effect.
    // The schema does not contain the field, so it is dropped before the
    // service is reached.
    await requireVenue()
    const owner = trackCustomer(await createTestCustomer())
    const intruder = trackCustomer(await createTestCustomer())
    const court = await createTestCourt()
    const reference = nextReference()

    await createTestBooking({ courtId: court.id, customerAccountId: owner.id, reference })

    await establishCustomerSession({ id: intruder.id, email: intruder.email })

    const response = await lookup({
      reference,
      customerAccountId: owner.id,
      customerId: owner.id,
    })

    expect(response.status).toBe(404)
  })
})

describe('reference handling', () => {
  it('accepts a lower-case reference', async () => {
    await requireVenue()
    const owner = trackCustomer(await createTestCustomer())
    const court = await createTestCourt()
    const reference = nextReference()

    await createTestBooking({ courtId: court.id, customerAccountId: owner.id, reference })
    await establishCustomerSession({ id: owner.id, email: owner.email })

    const response = await lookup({ reference: reference.toLowerCase() })
    expect(response.status).toBe(200)
  })

  it('trims surrounding whitespace', async () => {
    await requireVenue()
    const owner = trackCustomer(await createTestCustomer())
    const court = await createTestCourt()
    const reference = nextReference()

    await createTestBooking({ courtId: court.id, customerAccountId: owner.id, reference })
    await establishCustomerSession({ id: owner.id, email: owner.email })

    const response = await lookup({ reference: `  ${reference}  ` })
    expect(response.status).toBe(200)
  })

  it('answers a malformed reference as not found, not as a validation error', async () => {
    // Distinguishing the two would tell a prober which shapes are worth trying.
    const owner = trackCustomer(await createTestCustomer())
    await establishCustomerSession({ id: owner.id, email: owner.email })

    const response = await lookup({ reference: 'nonsense' })
    expect(response.status).toBe(404)
  })

  it('is not vulnerable to a wildcard or SQL fragment in the reference', async () => {
    await requireVenue()
    const owner = trackCustomer(await createTestCustomer())
    const court = await createTestCourt()

    await createTestBooking({
      courtId: court.id,
      customerAccountId: owner.id,
      reference: nextReference(),
    })
    await establishCustomerSession({ id: owner.id, email: owner.email })

    for (const attempt of ['%', '_', "' OR '1'='1", 'TF-%-%']) {
      const response = await lookup({ reference: attempt })
      expect(response.status).toBe(404)
    }
  })
})

describe('response contents', () => {
  it('exposes no internal identifier', async () => {
    // Doc 10 §3.5 and §231: no booking UUID, no customer account id, no court
    // id. Only the reference is shared with a customer.
    await requireVenue()
    const owner = trackCustomer(await createTestCustomer())
    const court = await createTestCourt()
    const reference = nextReference()

    const bookingId = await createTestBooking({
      courtId: court.id,
      customerAccountId: owner.id,
      reference,
    })
    await establishCustomerSession({ id: owner.id, email: owner.email })

    const raw = JSON.stringify(await (await lookup({ reference })).json())

    expect(raw).not.toContain(bookingId)
    expect(raw).not.toContain(owner.id)
    expect(raw).not.toContain(court.id)
  })

  it('exposes no admin-only field', async () => {
    await requireVenue()
    const owner = trackCustomer(await createTestCustomer())
    const court = await createTestCourt()
    const reference = nextReference()

    await createTestBooking({ courtId: court.id, customerAccountId: owner.id, reference })
    await establishCustomerSession({ id: owner.id, email: owner.email })

    const raw = JSON.stringify(await (await lookup({ reference })).json())

    for (const field of [
      'notes',
      'ipAddress',
      'userAgent',
      'approvedBy',
      'rejectedBy',
      'cancelledBy',
      'customerAccountId',
      'venueId',
      'expiresAt',
      'storageKey',
      'proofUrl',
    ]) {
      expect(raw).not.toContain(field)
    }
  })

  it('reports the payment status when a payment record exists', async () => {
    await requireVenue()
    const owner = trackCustomer(await createTestCustomer())
    const court = await createTestCourt()
    const reference = nextReference()

    const bookingId = await createTestBooking({
      courtId: court.id,
      customerAccountId: owner.id,
      reference,
      status: 'payment_submitted',
    })
    await createTestPaymentRecord(bookingId, { status: 'submitted' })
    await establishCustomerSession({ id: owner.id, email: owner.email })

    const body = await readEnvelope<{
      booking: { payment: { status: string | null }; awaitingPaymentProof: boolean }
    }>(await lookup({ reference }))

    expect(body.data?.booking.payment.status).toBe('submitted')
  })

  it('surfaces a payment rejection reason so the customer can re-upload', async () => {
    // Doc 24 §G.1: a rejected payment returns the booking to `pending`, and the
    // customer must be able to see WHY in order to correct it.
    await requireVenue()
    const owner = trackCustomer(await createTestCustomer())
    const court = await createTestCourt()
    const reference = nextReference()

    const bookingId = await createTestBooking({
      courtId: court.id,
      customerAccountId: owner.id,
      reference,
      status: 'pending',
    })
    await createTestPaymentRecord(bookingId, {
      status: 'rejected',
      rejectionReason: 'The screenshot was not legible.',
    })
    await establishCustomerSession({ id: owner.id, email: owner.email })

    const body = await readEnvelope<{
      booking: { payment: { rejectionReason: string | null }; awaitingPaymentProof: boolean }
    }>(await lookup({ reference }))

    expect(body.data?.booking.payment.rejectionReason).toBe('The screenshot was not legible.')
    expect(body.data?.booking.awaitingPaymentProof).toBe(true)
  })
})

describe('payment proof eligibility is decided by the server', () => {
  it('reports awaitingPaymentProof true only for a pending booking', async () => {
    await requireVenue()
    const owner = trackCustomer(await createTestCustomer())
    const court = await createTestCourt()

    const cases = [
      { status: 'pending' as const, expected: true },
      { status: 'payment_submitted' as const, expected: false },
      { status: 'approved' as const, expected: false },
      { status: 'rejected' as const, expected: false },
    ]

    await establishCustomerSession({ id: owner.id, email: owner.email })

    for (const testCase of cases) {
      const reference = nextReference()
      await createTestBooking({
        courtId: court.id,
        customerAccountId: owner.id,
        reference,
        status: testCase.status,
        // A distinct slot per case: the exclusion constraint only guards
        // approved bookings, but keeping them apart makes the data honest.
        startTime: `${10 + cases.indexOf(testCase)}:00:00`,
        endTime: `${11 + cases.indexOf(testCase)}:00:00`,
      })

      const body = await readEnvelope<{ booking: { awaitingPaymentProof: boolean } }>(
        await lookup({ reference }),
      )
      expect(body.data?.booking.awaitingPaymentProof).toBe(testCase.expected)
    }
  })
})

describe('rate limiting', () => {
  it('returns 429 once the per-account budget is spent', async () => {
    // Doc 24 §I.6: 10 per 10 minutes per account. The account is the PRIMARY
    // key here because the abuse to bound is one signed-in account trying
    // references in bulk — which an IP limit alone would not stop.
    const owner = trackCustomer(await createTestCustomer())
    await establishCustomerSession({ id: owner.id, email: owner.email })

    const statuses: number[] = []
    for (let attempt = 0; attempt < 12; attempt += 1) {
      // A fresh IP each time, so only the ACCOUNT limiter can be the one that
      // trips. Without this the test would not prove which key was enforced.
      const response = await lookup({ reference: nextReference() }, uniqueIp())
      statuses.push(response.status)
    }

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0)
    expect(statuses.slice(0, 10).every((status) => status !== 429)).toBe(true)
  })

  it('never surfaces a limit breach as an unhandled 500', async () => {
    // Doc 22 §5.6: exceeding a limit returns apiError('RATE_LIMITED', 429).
    const owner = trackCustomer(await createTestCustomer())
    await establishCustomerSession({ id: owner.id, email: owner.email })

    let sawRateLimit = false
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const response = await lookup({ reference: nextReference() }, uniqueIp())
      expect(response.status).not.toBe(500)
      if (response.status === 429) {
        const body = await readEnvelope(response)
        expect(body.error?.code).toBe('RATE_LIMITED')
        sawRateLimit = true
      }
    }
    expect(sawRateLimit).toBe(true)
  })
})

describe('transport defences', () => {
  it('rejects a request without the JSON content type', async () => {
    const owner = trackCustomer(await createTestCustomer())
    await establishCustomerSession({ id: owner.id, email: owner.email })

    const { POST } = await import('@/app/api/v1/booking-status/route')
    const response = await POST(
      jsonPost({ reference: nextReference() }, { contentType: 'text/plain' }),
    )

    expect(response.status).toBe(400)
  })
})
