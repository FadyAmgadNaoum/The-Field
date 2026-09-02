# Booking State Machine
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. Overview

Every booking follows a defined lifecycle. States and transitions are enforced at the service layer and validated by the API. The database stores the current state; the state machine logic lives in `src/modules/bookings/booking.state-machine.ts`.

No state transition may happen outside the rules defined in this document. The application must reject any attempt to skip states, transition backwards (except where explicitly allowed), or perform unauthorized transitions.

---

## 2. Booking Status States

| State | Meaning | Slot Held? |
|-------|---------|------------|
| `pending` | Booking created; no payment proof submitted yet | Yes (soft) |
| `payment_submitted` | Customer uploaded payment proof | Yes (soft) |
| `under_review` | Administrator has opened the booking for review | Yes (soft) |
| `approved` | Administrator verified payment and confirmed booking | Yes (hard) |
| `rejected` | Administrator rejected the booking | No |
| `cancelled` | Booking was cancelled after approval | No |
| `expired` | Booking was not paid within the expiry window | No |

**"Soft hold":** The slot is unavailable to new bookings but is not yet hard-confirmed. If the booking expires, is rejected, or is cancelled, the slot is released immediately.

**"Hard confirmed":** The slot is permanently reserved. Only the administrator can release it via cancellation.

---

## 3. Payment Status States

| State | Meaning |
|-------|---------|
| `pending` | No payment proof has been uploaded |
| `submitted` | Customer uploaded a proof; awaiting admin review |
| `verified` | Administrator confirmed the payment |
| `rejected` | Administrator rejected the payment proof |

Payment status is independent of booking status. Both must be tracked separately.

---

## 4. Booking State Transition Diagram

```
                         ┌─────────────┐
                    ┌───►│   EXPIRED   │ (system: auto after timeout)
                    │    └─────────────┘
                    │
 [Customer submits] │
 ┌─────────────┐    │    ┌─────────────────────┐
 │   PENDING   ├────┘    │ Slot released        │
 └──────┬──────┘         └─────────────────────┘
        │
        │ [Customer uploads proof]
        │
 ┌──────▼──────────────┐
 │  PAYMENT_SUBMITTED  │
 └──────┬──────────────┘
        │
        │ [Admin opens for review — optional state]
        │
 ┌──────▼──────────────┐
 │    UNDER_REVIEW     │◄──────────────────────────────────┐
 └──────┬──────────────┘                                   │
        │                                                  │ [Admin requests
        ├─────────────────────────────────────────────┐   │  more info — rare]
        │                                             │   │
        │ [Admin verifies payment                     │   │
        │  AND approves booking]                      │   │
        │                                             │   │
 ┌──────▼──────┐                             ┌───────▼───┴──────┐
 │  APPROVED   │                             │    REJECTED       │
 └──────┬──────┘                             └──────────────────┘
        │                                    (slot released)
        │ [Admin cancels]
        │
 ┌──────▼──────┐
 │  CANCELLED  │
 └─────────────┘
 (slot released)
```

---

## 5. Allowed Transitions

| From State | To State | Actor | Trigger | Conditions |
|-----------|---------|-------|---------|-----------|
| `pending` | `payment_submitted` | Customer | Upload payment proof | Booking exists and is in `pending` state |
| `pending` | `expired` | System (cron job) | Timeout reached | `expires_at` < NOW() and no proof uploaded |
| `payment_submitted` | `under_review` | Admin | Open review | Admin has `view_bookings` permission |
| `payment_submitted` | `approved` | Admin | Approve directly | Admin has `approve_booking` + `verify_payment` permissions; availability re-validated |
| `payment_submitted` | `rejected` | Admin | Reject | Admin has `reject_booking` permission |
| `under_review` | `approved` | Admin | Approve | Admin has `approve_booking` + `verify_payment` permissions; availability re-validated |
| `under_review` | `rejected` | Admin | Reject | Admin has `reject_booking` permission |
| `approved` | `cancelled` | Admin | Cancel | Admin has `cancel_booking` permission |
| `rejected` | — | — | — | Terminal state; no further transitions |
| `cancelled` | — | — | — | Terminal state; no further transitions |
| `expired` | — | — | — | Terminal state; no further transitions |

**Important rules:**
- A customer CANNOT approve their own booking.
- A customer CANNOT transition a booking to `under_review`, `approved`, `rejected`, or `cancelled`.
- A customer CANNOT directly transition from `pending` to `approved` or `payment_submitted` to `approved`.
- Approval ALWAYS re-validates availability before committing.
- Rejection and expiry ALWAYS release the slot immediately.

**Known race condition — two `pending` bookings for the same slot:**

Two concurrent booking creation requests can each successfully create a `pending` booking for the same slot. This is accepted behaviour in V1. The reasoning: the application-level `SELECT FOR UPDATE` check locks existing rows; when no rows yet exist for that slot, two simultaneous transactions both see 0 rows and both insert successfully.

The consequence is managed as follows:
- Both bookings hold the slot as a soft-hold. No further customer can book that slot.
- When the admin approves one booking, the exclusion constraint prevents the other from also being approved.
- The admin sees a conflict error when attempting to approve the second booking.
- The admin must reject the second booking manually.
- This is the expected operating procedure.

The alternative — using a UNIQUE constraint or exclusion constraint on `pending` status — would cause spurious conflicts during the soft-hold window and create more operational complexity than the race condition itself. The tradeoff is explicitly accepted.

---

## 6. Payment Status Transition Table

| From | To | Actor | Trigger | Booking State Required |
|------|-----|-------|---------|----------------------|
| `pending` | `submitted` | Customer | Upload proof | `pending` or `payment_submitted` booking |
| `submitted` | `verified` | Admin | Verify payment | `payment_submitted` or `under_review` booking |
| `submitted` | `rejected` | Admin | Reject payment | `payment_submitted` or `under_review` booking |
| `verified` | — | — | — | Terminal (can only accompany booking `approved`) |
| `rejected` | `submitted` | Customer | Re-upload proof | If booking is still not `rejected`/`expired` |

**Note on re-upload:** If an admin rejects a payment proof (e.g., blurry image, wrong amount), the customer can re-upload a new proof. The booking status returns to `payment_submitted` to re-enter the review queue. This prevents a customer from being permanently blocked by a technicality.

---

## 7. State Machine Implementation

### 7.1 Service Function Contract

```typescript
// src/modules/bookings/booking.service.ts

type BookingTransitionResult =
  | { success: true; booking: Booking }
  | { success: false; error: BookingTransitionError };

async function submitPaymentProof(
  bookingId: string,
  customerId: string,
  file: UploadedFile
): Promise<BookingTransitionResult>

async function markUnderReview(
  bookingId: string,
  adminId: string
): Promise<BookingTransitionResult>

async function approveBooking(
  bookingId: string,
  adminId: string
): Promise<BookingTransitionResult>

async function rejectBooking(
  bookingId: string,
  adminId: string,
  reason: string
): Promise<BookingTransitionResult>

async function cancelBooking(
  bookingId: string,
  adminId: string,
  reason: string
): Promise<BookingTransitionResult>

async function expireStaleBookings(): Promise<{ expiredCount: number }>
```

### 7.2 Transition Guard

Before every transition, the service calls `assertTransitionAllowed(currentStatus, targetStatus, actorType)`. If the transition is not in the allowed table above, it throws `BookingTransitionForbiddenError` which the API layer converts to HTTP 422.

```typescript
function assertTransitionAllowed(
  from: BookingStatus,
  to: BookingStatus,
  actor: 'customer' | 'admin' | 'system'
): void {
  const key = `${from}→${to}:${actor}`;
  if (!ALLOWED_TRANSITIONS.has(key)) {
    throw new BookingTransitionForbiddenError(
      `Transition from ${from} to ${to} is not allowed for ${actor}`
    );
  }
}
```

---

## 8. Expiry Job Specification

**Schedule:** Every 15 minutes (configurable via `BOOKING_EXPIRY_JOB_INTERVAL_MINUTES` env var).

**Logic:**

```typescript
async function expireStaleBookings(): Promise<void> {
  const expiredBookings = await db
    .update(bookings)
    .set({ status: 'expired', updated_at: new Date() })
    .where(
      and(
        inArray(bookings.status, ['pending']),
        lt(bookings.expires_at, new Date())
      )
    )
    .returning({ id: bookings.id, reference: bookings.booking_reference });

  for (const b of expiredBookings) {
    await audit.log({
      action: 'booking_expired',
      entityType: 'booking',
      entityId: b.id,
      adminId: null,   // system action
      metadata: { reason: 'payment_timeout' }
    });
  }
}
```

**Notes:**
- Only `pending` bookings expire. `payment_submitted` and `under_review` bookings do NOT expire automatically — the admin must take action.
- If a `payment_submitted` booking has been waiting for more than 24 hours without admin action, it appears flagged in the admin dashboard (visual indicator only; no automatic state change).

---

## 9. Concurrent Approval Scenario — Detailed Flow

**Scenario:** Two admins (Admin A and Admin B) both have the booking management dashboard open. They both see Booking #TF-20260905-K7M2 in the `payment_submitted` state. Admin A clicks "Approve" at time T. Admin B also clicks "Approve" at time T+0.1s.

**Resolution:**

```
Admin A request arrives:
  BEGIN TRANSACTION;
  SELECT id FROM bookings
    WHERE court_id = 'court-uuid'
      AND booking_date = '2026-09-05'
      AND status = 'approved'
      AND NOT (end_time <= '19:00' OR start_time >= '20:00')
    FOR UPDATE;
  -- Returns 0 rows (no conflict)
  UPDATE bookings SET status = 'approved' WHERE id = 'booking-uuid';
  COMMIT;
  -- Returns HTTP 200 OK

Admin B request arrives (T+0.1s):
  BEGIN TRANSACTION;
  SELECT id FROM bookings ... FOR UPDATE;
  -- Still returns 0 rows (Admin A's booking is now 'approved',
  --   but that booking IS the one being approved — it's the same booking)
  -- Wait: Admin B is approving the SAME booking.
  -- The booking is already 'approved' — transition guard catches this:
  assertTransitionAllowed('approved', 'approved', 'admin') → throws error
  ROLLBACK;
  -- Returns HTTP 422 "This booking has already been approved."
```

**Alternate scenario:** Admin A approves Booking X (Court 1, 19:00–20:00). Meanwhile a different admin approves Booking Y (same court, same slot) that was created from a different customer's request:

```
Admin A commits Booking X → 'approved'. Exclusion constraint now guards.

Admin B attempts to approve Booking Y (same slot):
  BEGIN TRANSACTION;
  UPDATE bookings SET status = 'approved' WHERE id = 'booking-y-uuid';
  -- PostgreSQL exclusion constraint fires:
  -- ERROR: conflicting key value violates exclusion constraint "no_overlapping_approved_bookings"
  ROLLBACK;
  -- Application catches PostgreSQL error code 23P01 (exclusion_violation)
  -- Returns HTTP 409 "This time slot has already been confirmed for another booking."
```

This two-layer defense (application-level `FOR UPDATE` check + database-level exclusion constraint) ensures correctness even under adversarial conditions.

---

## 10. State Visibility Per Actor

| State | Customer Sees | Admin Sees |
|-------|--------------|-----------|
| `pending` | "Booking Received – Awaiting Payment" | "Pending – No Payment" |
| `payment_submitted` | "Payment Submitted – Under Review" | "Payment Submitted – Needs Verification" |
| `under_review` | "Payment Submitted – Under Review" | "Under Review" |
| `approved` | "Booking Confirmed" | "Confirmed" |
| `rejected` | "Booking Rejected" | "Rejected – [reason]" |
| `cancelled` | "Booking Cancelled" | "Cancelled – [reason]" |
| `expired` | "Booking Expired" | "Expired – No Payment Received" |

Customers see simplified, friendly labels. Admins see operational labels with reasons attached.
