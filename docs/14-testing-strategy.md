# Testing Strategy
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. Testing Philosophy

- **Test behavior, not implementation.** Tests verify that the system produces correct outputs for given inputs, not that internal functions are called in a specific way.
- **Critical paths have the deepest coverage.** The booking engine, price calculation, state machine transitions, and payment verification are the highest-risk code and get the most tests.
- **Tests run fast.** Unit tests must complete in under 30 seconds. E2E tests run in under 5 minutes total.
- **Tests are deterministic.** No flaky tests are tolerated. Tests that depend on real time use controlled clocks.
- **Security is tested.** Unauthorized access attempts, IDOR scenarios, and price manipulation are explicit test cases.

---

## 2. Test Stack

| Layer | Tool | Rationale |
|-------|------|-----------|
| Unit / Integration | Vitest | Fast, Vite-native, compatible with TypeScript without extra config. Drop-in replacement for Jest. |
| E2E | Playwright | Industry standard, cross-browser, excellent async handling, network intercept capability. |
| Database tests | Vitest + real PostgreSQL (Docker) | Integration tests run against a real PG instance to catch constraint violations, race conditions. |
| API tests | Vitest + `supertest` | Test API route handlers in isolation. |
| Security scanning | OWASP ZAP, Semgrep | Automated in CI; manual with Burp Suite pre-launch. |
| Coverage | Vitest (v8 provider) | C8 coverage maps to TypeScript source. |
| Accessibility | axe-core (via Playwright) | Catch WCAG violations in E2E tests. |

---

## 3. Test Directory Structure

```
tests/
├── unit/
│   ├── modules/
│   │   ├── booking/
│   │   │   ├── booking-reference.test.ts
│   │   │   ├── booking-state-machine.test.ts
│   │   │   └── booking-expiry.test.ts
│   │   ├── pricing/
│   │   │   ├── price-calculator.test.ts
│   │   │   └── pricing-rules.test.ts
│   │   ├── availability/
│   │   │   ├── slot-generator.test.ts
│   │   │   └── conflict-detection.test.ts
│   │   ├── payments/
│   │   │   └── payment-status-transitions.test.ts
│   │   ├── auth/
│   │   │   ├── permission-check.test.ts
│   │   │   └── session-validation.test.ts
│   │   └── cms/
│   │       └── cms-validators.test.ts
│   └── lib/
│       ├── date-utils.test.ts
│       └── phone-validator.test.ts
│
├── integration/
│   ├── api/
│   │   ├── bookings/
│   │   │   ├── create-booking.test.ts
│   │   │   ├── booking-status-lookup.test.ts
│   │   │   └── proof-upload.test.ts
│   │   └── admin/
│   │       ├── admin-auth.test.ts
│   │       ├── approve-booking.test.ts
│   │       ├── reject-booking.test.ts
│   │       └── pricing-management.test.ts
│   ├── database/
│   │   ├── booking-constraint.test.ts
│   │   ├── concurrent-bookings.test.ts
│   │   └── expiry-job.test.ts
│   └── storage/
│       └── file-upload.test.ts
│
├── e2e/
│   ├── customer/
│   │   ├── full-booking-flow.spec.ts
│   │   ├── booking-status-lookup.spec.ts
│   │   ├── availability-display.spec.ts
│   │   └── late-proof-upload.spec.ts
│   ├── admin/
│   │   ├── admin-login.spec.ts
│   │   ├── approve-booking.spec.ts
│   │   ├── reject-booking.spec.ts
│   │   ├── court-management.spec.ts
│   │   └── cms-editing.spec.ts
│   └── security/
│       ├── idor-attempts.spec.ts
│       ├── unauthorized-admin-access.spec.ts
│       ├── price-manipulation.spec.ts
│       └── concurrent-booking.spec.ts
│
└── fixtures/
    ├── seed-test-db.ts
    ├── factories/
    │   ├── booking.factory.ts
    │   ├── customer.factory.ts
    │   ├── court.factory.ts
    │   └── admin.factory.ts
    └── mocks/
        ├── storage.mock.ts
        └── time.mock.ts
```

---

## 4. Unit Tests

### 4.1 Price Calculator

```typescript
// tests/unit/modules/pricing/price-calculator.test.ts

describe('PriceCalculator', () => {
  it('returns base price when no peak rule applies', () => {
    const rules = [{ dayApplicable: [0,1,2,3], startTime: '08:00', endTime: '17:00', price: 300 }]
    expect(calculatePrice(rules, new Date('2026-09-07'), '10:00', '11:00')).toBe(300)
  })

  it('returns peak price on matching day and time', () => {
    const rules = [
      { dayApplicable: [4,5,6], startTime: '18:00', endTime: '24:00', price: 450, priority: 1 },
      { dayApplicable: [0,1,2,3,4,5,6], startTime: '08:00', endTime: '24:00', price: 350, priority: 0 },
    ]
    // Friday (day 5), 20:00 → peak rule applies
    expect(calculatePrice(rules, new Date('2026-09-04'), '20:00', '21:00')).toBe(450)
  })

  it('uses higher-priority rule when multiple rules match', () => {
    const rules = [
      { dayApplicable: [5], startTime: '08:00', endTime: '24:00', price: 400, priority: 1 },
      { dayApplicable: [0,1,2,3,4,5,6], startTime: '08:00', endTime: '24:00', price: 350, priority: 0 },
    ]
    expect(calculatePrice(rules, new Date('2026-09-04'), '10:00', '11:00')).toBe(400)
  })

  it('throws NoPricingConfiguredError when no rule matches', () => {
    expect(() => calculatePrice([], new Date('2026-09-07'), '10:00', '11:00'))
      .toThrow(NoPricingConfiguredError)
  })
})
```

### 4.2 Booking State Machine

```typescript
// tests/unit/modules/booking/booking-state-machine.test.ts

describe('BookingStateMachine', () => {
  describe('assertTransitionAllowed', () => {
    it('allows customer to submit proof from pending', () => {
      expect(() => assertTransitionAllowed('pending', 'payment_submitted', 'customer')).not.toThrow()
    })

    it('prevents customer from approving their own booking', () => {
      expect(() => assertTransitionAllowed('payment_submitted', 'approved', 'customer'))
        .toThrow(BookingTransitionForbiddenError)
    })

    it('prevents admin from approving from pending state (requires proof first)', () => {
      expect(() => assertTransitionAllowed('pending', 'approved', 'admin'))
        .toThrow(BookingTransitionForbiddenError)
    })

    it('allows admin to approve from payment_submitted', () => {
      expect(() => assertTransitionAllowed('payment_submitted', 'approved', 'admin')).not.toThrow()
    })

    it('allows system to expire pending bookings', () => {
      expect(() => assertTransitionAllowed('pending', 'expired', 'system')).not.toThrow()
    })

    it('prevents transitioning from a terminal state', () => {
      expect(() => assertTransitionAllowed('rejected', 'pending', 'admin'))
        .toThrow(BookingTransitionForbiddenError)
    })
  })
})
```

### 4.3 Availability / Conflict Detection

```typescript
// tests/unit/modules/availability/conflict-detection.test.ts

describe('hasTimeOverlap', () => {
  it('detects full overlap', () => {
    expect(hasTimeOverlap('18:00', '19:00', '18:00', '19:00')).toBe(true)
  })
  it('detects partial overlap (start within)', () => {
    expect(hasTimeOverlap('18:30', '19:30', '18:00', '19:00')).toBe(true)
  })
  it('detects adjacent slots as non-overlapping', () => {
    expect(hasTimeOverlap('18:00', '19:00', '19:00', '20:00')).toBe(false)
  })
  it('detects non-overlapping earlier slot', () => {
    expect(hasTimeOverlap('16:00', '17:00', '18:00', '19:00')).toBe(false)
  })
})
```

### 4.4 Permission Checks

```typescript
describe('requirePermission', () => {
  it('passes when admin has permission', async () => {
    const session = { adminId: 'uuid', roleId: 'admin-role-id', issuedAt: Date.now() }
    mockPermissionsRepo.returns(['approve_booking', 'verify_payment'])
    await expect(requirePermission(session, 'approve_booking')).resolves.not.toThrow()
  })

  it('throws ForbiddenError when permission is missing', async () => {
    const session = { adminId: 'uuid', roleId: 'viewer-role-id', issuedAt: Date.now() }
    mockPermissionsRepo.returns(['view_bookings'])
    await expect(requirePermission(session, 'approve_booking')).rejects.toThrow(ForbiddenError)
  })
})
```

---

## 5. Integration Tests

### 5.1 Booking Creation API

```typescript
// tests/integration/api/bookings/create-booking.test.ts

describe('POST /api/v1/bookings', () => {
  it('creates a booking and returns reference', async () => {
    const res = await request(app).post('/api/v1/bookings').send({
      courtId: testCourt.id,
      date: '2026-09-10',
      startTime: '18:00',
      endTime: '19:00',
      customerName: 'Ahmed Mohamed',
      customerPhone: '01012345678',
    })
    expect(res.status).toBe(201)
    expect(res.body.data.bookingReference).toMatch(/^TF-\d{8}-[A-Z0-9]{4}$/)
    expect(res.body.data.bookingStatus).toBe('pending')
  })

  it('rejects booking when slot is already pending', async () => {
    // seed: existing pending booking for same court/date/time
    const res = await request(app).post('/api/v1/bookings').send({
      courtId: testCourt.id,
      date: '2026-09-10',
      startTime: '18:00',
      endTime: '19:00',
      customerName: 'Omar Hassan',
      customerPhone: '01098765432',
    })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('BOOKING_CONFLICT')
  })

  it('rejects booking on a blocked date', async () => {
    // seed: blocked_dates entry for 2026-09-11
    const res = await request(app).post('/api/v1/bookings').send({
      courtId: testCourt.id,
      date: '2026-09-11',
      startTime: '18:00',
      endTime: '19:00',
      customerName: 'Test Customer',
      customerPhone: '01012345678',
    })
    expect(res.status).toBe(400)
  })

  it('uses server-calculated price, ignores client-submitted price', async () => {
    // Even if client sends price: 1, the booking should store the correct DB price
    const res = await request(app).post('/api/v1/bookings').send({
      courtId: testCourt.id,
      date: '2026-09-10',
      startTime: '18:00',
      endTime: '19:00',
      customerName: 'Test',
      customerPhone: '01012345678',
      price: 1,  // malicious
    })
    expect(res.status).toBe(201)
    const booking = await db.query.bookings.findFirst({ where: eq(bookings.bookingReference, res.body.data.bookingReference) })
    expect(booking?.price_amount).toBe(350)  // correct server price, not 1
  })
})
```

### 5.2 Concurrent Booking Test (Database Level)

```typescript
// tests/integration/database/concurrent-bookings.test.ts

it('prevents double-booking under concurrent requests', async () => {
  const payload = {
    courtId: testCourt.id,
    date: '2026-09-15',
    startTime: '20:00',
    endTime: '21:00',
    customerName: 'Customer',
    customerPhone: '01012345678',
  }

  // Fire 10 simultaneous requests for the same slot
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      request(app).post('/api/v1/bookings').send(payload)
    )
  )

  const successes = results.filter(r => r.status === 'fulfilled' && r.value.status === 201)
  const conflicts = results.filter(r => r.status === 'fulfilled' && r.value.status === 409)

  expect(successes.length).toBe(1)   // exactly one booking created
  expect(conflicts.length).toBe(9)   // all others rejected
})
```

### 5.3 Admin Approval with Conflict

```typescript
it('returns conflict error when approving a booking that was already taken', async () => {
  // Setup: bookingA (approved) and bookingB (payment_submitted) for same slot
  await adminApproveBooking(bookingA.id)  // approve A first
  const res = await adminApproveBooking(bookingB.id)  // try to approve B
  expect(res.status).toBe(409)
  expect(res.body.error.code).toBe('BOOKING_CONFLICT')
})
```

### 5.4 Booking Expiry Job

```typescript
it('expires pending bookings after timeout', async () => {
  const booking = await createPendingBooking({ expiresAt: new Date(Date.now() - 1000) })
  await expireStaleBookings()
  const updated = await getBooking(booking.id)
  expect(updated.status).toBe('expired')
})

it('does not expire payment_submitted bookings', async () => {
  const booking = await createBookingWithProof({ expiresAt: new Date(Date.now() - 1000) })
  await expireStaleBookings()
  const updated = await getBooking(booking.id)
  expect(updated.status).toBe('payment_submitted')
})
```

---

## 6. End-to-End Tests (Playwright)

### 6.1 Full Customer Booking Flow

```typescript
// tests/e2e/customer/full-booking-flow.spec.ts

test('customer can complete a full booking', async ({ page }) => {
  await page.goto('/')

  // Click Book Now from homepage
  await page.click('text=Book Now')
  await expect(page).toHaveURL('/book')

  // Select court
  await page.click('[data-court-id]')

  // Select date (tomorrow)
  const tomorrow = formatDate(addDays(new Date(), 1))
  await page.fill('[data-testid=date-picker]', tomorrow)

  // Select time slot
  await page.click('[data-slot="18:00"]')

  // Verify price is shown
  await expect(page.locator('[data-testid=booking-price]')).toContainText('EGP')

  // Fill customer form
  await page.fill('[data-testid=customer-name]', 'Ahmed Mohamed')
  await page.fill('[data-testid=customer-phone]', '01012345678')

  // Upload payment proof
  await page.setInputFiles('[data-testid=proof-upload]', 'tests/fixtures/files/proof.jpg')

  // Submit
  await page.click('[data-testid=submit-booking]')

  // Verify confirmation
  await expect(page.locator('[data-testid=booking-reference]')).toBeVisible()
  await expect(page.locator('[data-testid=booking-reference]')).toHaveText(/^TF-/)
  await expect(page.locator('[data-testid=booking-status]')).toContainText('Payment Submitted')
})
```

### 6.2 Admin Booking Approval Flow

```typescript
test('admin can verify payment and approve booking', async ({ page }) => {
  // Seed: existing payment_submitted booking
  const booking = await seedPaymentSubmittedBooking()

  // Admin login
  await page.goto('/admin/login')
  await page.fill('[data-testid=email]', 'admin@thefield.eg')
  await page.fill('[data-testid=password]', 'TestPassword123!')
  await page.click('[data-testid=login-button]')
  await expect(page).toHaveURL('/admin/dashboard')

  // Navigate to booking
  await page.goto(`/admin/bookings/${booking.id}`)

  // View proof
  await page.click('[data-testid=view-proof]')
  await expect(page.locator('[data-testid=proof-viewer]')).toBeVisible()

  // Approve
  await page.click('[data-testid=approve-booking]')
  await page.click('[data-testid=confirm-approval]')  // confirmation dialog

  // Verify result
  await expect(page.locator('[data-testid=booking-status]')).toContainText('Confirmed')
})
```

### 6.3 Security — IDOR Test

```typescript
// tests/e2e/security/idor-attempts.spec.ts

test('customer cannot access another customers booking by reference', async ({ page }) => {
  const bookingA = await seedBooking({ customerAccount: 'customer-a' })
  const bookingB = await seedBooking({ customerAccount: 'customer-b' })

  await signInAs(page, bookingB.customerAccount)
  await page.goto('/booking-status')
  await page.fill('[data-testid=reference]', bookingA.reference)
  await page.click('[data-testid=lookup]')

  await expect(page.locator('[data-testid=error]')).toContainText('not found')
  await expect(page.locator('[data-testid=booking-details]')).not.toBeVisible()
})
```

### 6.4 Security — Price Manipulation Test

```typescript
test('server ignores client-manipulated price', async ({ page, authenticatedCustomerRequest }) => {
  // Intercept the booking submission and inject manipulated price
  const response = await authenticatedCustomerRequest.post('/api/v1/bookings', {
    data: {
      courtId: testCourtId,
      date: tomorrowDate,
      startTime: '18:00',
      endTime: '19:00',
      customerName: 'Attacker',
      customerPhone: '01012345678',
      priceAmount: 1,       // ← injected malicious price
    }
  })
  expect(response.status()).toBe(201)
  const data = await response.json()

  // Check the booking record has the correct price
  const booking = await getBookingFromDB(data.data.bookingReference)
  expect(booking.price_amount).toBeGreaterThan(1)  // server-calculated price
})
```

### 6.5 Unauthorized Admin Access Test

```typescript
test('unauthenticated user cannot access admin dashboard', async ({ page }) => {
  await page.goto('/admin/dashboard')
  await expect(page).toHaveURL('/admin/login')
})

test('viewer role cannot approve bookings', async ({ page }) => {
  await loginAsViewer(page)
  const res = await page.request.post(`/api/v1/admin/bookings/${bookingId}/approve`)
  expect(res.status()).toBe(403)
})
```

---

## 7. Coverage Targets

| Module | Target Coverage | Priority |
|--------|----------------|----------|
| Booking engine (create, validate, state) | 85% | P1 |
| Price calculator | 90% | P1 |
| Availability / conflict detection | 85% | P1 |
| Payment status transitions | 85% | P1 |
| Permission checks | 80% | P1 |
| CMS validators | 70% | P2 |
| API route handlers | 70% | P1 |
| Overall project | 70% | Target |

Coverage is measured by Vitest's v8 provider and reported in CI.

---

## 8. Test Data Management

- Integration and E2E tests run against a dedicated test PostgreSQL database.
- The test database is reset before each test suite (not each individual test — that would be too slow).
- Factories (`booking.factory.ts`, `customer.factory.ts`, etc.) create test data with sensible defaults and allow overrides.
- Fixtures directory contains sample files: `proof.jpg` (valid JPEG), `proof.pdf` (valid PDF), `malicious.php` (invalid — for upload rejection tests), `oversized.jpg` (11MB — for size limit tests).
- Time-sensitive tests use Vitest's `vi.useFakeTimers()` to control the clock.

---

## 9. CI Pipeline Integration

```yaml
# .github/workflows/ci.yml (or equivalent for Hostinger deployment)

steps:
  - name: Install dependencies
    run: npm ci

  - name: Type check
    run: npm run typecheck

  - name: Lint
    run: npm run lint

  - name: Unit tests
    run: npm run test:unit -- --run

  - name: Integration tests (requires Docker PG)
    run: npm run test:integration -- --run

  - name: Security scan (Semgrep)
    run: semgrep --config=auto src/

  - name: Dependency audit
    run: npm audit --audit-level=high

  - name: Build
    run: npm run build

  - name: E2E tests (Playwright)
    run: npm run test:e2e
```

All steps must pass before deployment is permitted to the staging environment.
