# Architecture Review Report
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Review Type:** Pre-Implementation Principal Architect Review  
**Status:** APPROVED WITH REQUIRED CHANGES

---

## Review Scope

This report reviews all 21 specification documents produced for Version 1 of The Field padel court booking website. It acts simultaneously as:

- Principal Software Architect review
- Senior Backend Engineer review
- Senior Security Engineer review
- QA Architect review

Version 1 is exclusively for **The Field** — one venue, one booking system. No multi-venue, multi-club, marketplace, or venue-owner functionality is implemented in Version 1. This scope constraint is confirmed throughout the documents and upheld in this review.

---

## Table of Contents

1. Architecture Review Report Summary
2. Identified Issues
3. Required Changes
4. Security Findings
5. Booking Integrity Findings
6. Database Findings
7. CMS Findings
8. Deployment Findings
9. Open Business Decisions
10. Final Recommended Architecture
11. Final Technology Stack
12. Final Implementation Order
13. Definition of Done for Version 1

---

## 1. Architecture Review Report Summary

The specification is of high quality and covers the domain thoroughly. The modular monolith approach, venue-aware schema, server-authoritative pricing, and layered booking integrity design are all sound. The security threat model is comprehensive and well-mapped to OWASP.

However, the review has identified **7 required changes** that must be resolved before implementation begins, and **12 advisory findings** that require attention during implementation. The required changes address real technical correctness issues — not stylistic preferences.

### Overall Assessment

| Area | Status | Severity of Issues |
|------|--------|--------------------|
| Booking integrity (concurrency) | PASS with caveat | Medium — one constraint technical error |
| Booking state machine | PASS | Clean |
| Payment workflow | PASS | Clean |
| Admin authorization | PASS | Clean |
| IDOR prevention | PASS | Clean |
| Payment proof security | PASS | Clean |
| File upload security | PASS | Clean |
| CMS architecture | PASS | Clean |
| Authentication | PASS | Clean |
| RBAC | PASS | Clean |
| Rate limiting | PASS with gap | Medium — one endpoint missing |
| API security | PASS | Clean |
| Database indexes | PASS with addition | Low — one index missing |
| Transaction boundaries | PASS with correction | High — file upload transaction gap |
| Race conditions | PASS with note | Medium — one residual scenario |
| Hostinger deployment | PASS | Clean |
| Backup strategy | PASS | Clean |
| Logging | PASS with correction | Low — one sensitive field gap |
| Monitoring | PASS | Clean |
| Testing | PASS | Clean |
| Future scalability | PASS | Clean |
| Open business decisions | ACTION REQUIRED | 4 decisions unresolved |
| Language / i18n | ACTION REQUIRED | Language decision unresolved |

---

## 2. Identified Issues

### ISSUE-001 — CRITICAL: `timerange` Type Does Not Exist in PostgreSQL
**Document:** 05-database-architecture.md, Section 4.9  
**Severity:** Critical — will cause migration failure  
**Category:** Database

The exclusion constraint is specified as:

```sql
EXCLUDE USING GIST (
    court_id    WITH =,
    booking_date WITH =,
    timerange(start_time, end_time) WITH &&
) WHERE (status = 'approved');
```

**`timerange` is not a built-in PostgreSQL type.** PostgreSQL provides `tsrange` (timestamp range), `tstzrange` (timestamptz range), `daterange`, `int4range`, `int8range`, and `numrange`. There is no `timerange` for `TIME` columns.

This constraint as written will fail with:
```
ERROR: function timerange(time without time zone, time without time zone) does not exist
```

**Also noted:** In Doc 04 (system architecture), the same constraint uses `tsrange(start_time, end_time)` — which also fails because `start_time` and `end_time` are `TIME` columns, not `TIMESTAMP`.

This inconsistency between documents (one says `timerange`, one says `tsrange`) confirms both are incorrect.

**Fix required:** See Section 3, Required Change RC-001.

---

### ISSUE-002 — HIGH: File Upload Outside Transaction Boundary
**Document:** 04-system-architecture.md, Section 4 (Request Flow); 07-payment-verification-workflow.md, Section 4  
**Severity:** High — data inconsistency risk  
**Category:** Transaction boundaries

The booking creation flow shows:

```
4e. db.transaction()
    INSERT booking (status: pending)
    INSERT payment record (status: pending)
    INSERT customer (upsert on phone)
    COMMIT

5. If file uploaded: storage.service.saveProof(file, bookingId)
    → Update payment status to 'submitted'
    → Update booking status to 'payment_submitted'
```

The file upload and subsequent status updates happen **outside the initial transaction**. This creates a failure window:

- Transaction commits (booking + payment record created, both `pending`)
- File upload to R2 succeeds
- Server crashes before `UPDATE payment_records` executes
- Result: A proof file exists in storage but the database still shows `pending` with no proof reference

The reverse failure is worse:
- Transaction commits
- Server starts file upload
- R2 upload fails (network error, timeout)
- Booking remains `pending`, no proof attached
- But the booking reference has already been returned to the customer who saw a success screen

**Fix required:** See Section 3, Required Change RC-002.

---

### ISSUE-003 — HIGH: Booking Reference Prefix Is Hardcoded in Doc 17 as a V1 Debt Item, But Not in the Database Schema
**Document:** 05-database-architecture.md, Section 5; 17-future-scalability-strategy.md, Section 6  
**Severity:** High — inconsistency between documents  
**Category:** Future scalability

Doc 05 defines the booking reference format as `TF-YYYYMMDD-XXXX` where `TF` is stated as "The Field prefix (venue-specific)". Doc 17 correctly identifies the hardcoded `TF-` prefix as a known V1 shortcut that must be fixed before multi-venue.

However, the `venues` table has no `booking_reference_prefix` column. If the prefix is generated in application code as a constant `"TF"`, it will work for V1, but the `venues` table has no column to hold a future venue's prefix.

This is a V1 shortcut that is already acknowledged in Doc 17, but the database schema should be updated to store the prefix, or the generation code must explicitly source it from the `venues` table in V1.

**Fix required:** See Section 3, Required Change RC-003.

---

### ISSUE-004 — MEDIUM: `payment_submitted` Status Expiry Logic Gap
**Document:** 06-booking-state-machine.md, Section 8; 02-functional-requirements.md FR-BKG-040  
**Severity:** Medium — business rule ambiguity  
**Category:** Booking state machine

FR-BKG-040 states: "A booking in `pending` status with no payment proof submitted must expire after a configurable timeout."

The expiry job in Doc 06 only expires `pending` bookings:

```typescript
inArray(bookings.status, ['pending']),
```

Doc 06 notes: "`payment_submitted` and `under_review` bookings do NOT expire automatically — the admin must take action." It also notes these are visually flagged in the dashboard after 24 hours.

This is a deliberate design choice, but it creates a gap: if an admin is unavailable for an extended period (illness, holiday), `payment_submitted` bookings can hold their slot indefinitely. There is no system-level protection against indefinite soft-holds.

This is not a bug — it is a business policy decision. **The venue owner must be told about this behaviour and explicitly accept it.** The policy is documented as Open Business Decision OBD-005.

---

### ISSUE-005 — MEDIUM: Simultaneous Creation of Two `pending` Bookings for the Same Slot
**Document:** 04-system-architecture.md, Section 6; 05-database-architecture.md, Section 4.9  
**Severity:** Medium — race condition in soft-hold logic  
**Category:** Race conditions

The exclusion constraint only covers `status = 'approved'`:

```sql
WHERE (status = 'approved')
```

The application-level conflict check (SELECT FOR UPDATE) blocks pending/submitted/under_review:

```sql
AND status IN ('pending', 'payment_submitted', 'under_review', 'approved')
FOR UPDATE
```

This application-level check uses `SERIALIZABLE` isolation, which should prevent two concurrent `pending` inserts from succeeding. However, the mechanism is not as robust as the exclusion constraint because:

1. `SERIALIZABLE` isolation in PostgreSQL uses optimistic concurrency (SSI — Serializable Snapshot Isolation). Two concurrent transactions that both read 0 rows and both insert may both succeed if the SSI predicate lock logic does not detect the write-write conflict.
2. The `SELECT ... FOR UPDATE` only locks *existing* rows. If no rows exist (first booking for that slot), both transactions see 0 rows, neither locks anything, and both proceed to INSERT simultaneously.

The result: two `pending` bookings can exist for the same slot. This is the "soft-hold race condition." The exclusion constraint does not fire because neither booking is `approved` yet.

**This is a known and accepted behaviour in the current design** — the spec explicitly acknowledges that the exclusion constraint only covers `approved` bookings. The business justification is: the venue prefers preventing double payment submissions over the slight complexity of preventing double pending inserts.

However, the spec does not explicitly state this race is possible for `pending` inserts, and the testing strategy does not include a test for it. Both should be documented clearly.

**Fix required:** See Section 3, Required Change RC-004.

---

### ISSUE-006 — MEDIUM: `chk_booking_date_future` Constraint Will Reject Valid Same-Day Bookings at Midnight
**Document:** 05-database-architecture.md, Section 4.9  
**Severity:** Medium — operational correctness  
**Category:** Database constraints

```sql
CONSTRAINT chk_booking_date_future CHECK (booking_date >= CURRENT_DATE)
```

`CURRENT_DATE` returns the PostgreSQL server's current date in its configured timezone. The VPS stores timestamps in UTC but the venue operates on Egyptian Standard Time (UTC+2). At 22:00 EGT (20:00 UTC), `CURRENT_DATE` in UTC returns tomorrow's date already. This means a booking placed at 22:00 local time for today at 23:00 would fail this check because the PostgreSQL server's `CURRENT_DATE` is already tomorrow.

More practically: a customer at 11 PM Egypt time tries to book for later that same evening (say, 23:00–24:00). The server's UTC date is already "tomorrow," making `CURRENT_DATE > booking_date`, which causes this constraint to fail.

**Fix required:** See Section 3, Required Change RC-005.

---

### ISSUE-007 — MEDIUM: The `uq_court_name_per_venue` Constraint Is Semantically Broken
**Document:** 05-database-architecture.md, Section 4.2  
**Severity:** Medium — unique constraint design flaw  
**Category:** Database

```sql
CONSTRAINT uq_court_name_per_venue UNIQUE (venue_id, name, deleted_at)
```

In PostgreSQL, `UNIQUE` constraints treat `NULL` values as distinct — two `NULL` values are never considered equal for uniqueness purposes. This means this constraint allows two active courts (both with `deleted_at = NULL`) to have the same name in the same venue, because `NULL != NULL`.

Example: You could insert `(venue-uuid, "Court 1", NULL)` twice and the constraint would not fire.

**Fix required:** See Section 3, Required Change RC-006.

---

### ISSUE-008 — LOW: Rate Limiting on `/api/v1/courts` Is Not Specified
**Document:** 11-api-architecture.md, Section 4.2 and Section 7  
**Severity:** Low — minor gap  
**Category:** Rate limiting

The rate limiting summary table in Doc 11 covers the booking, status lookup, proof upload, and admin login endpoints. The public `GET /api/v1/courts` and `GET /api/v1/courts/{id}` endpoints are not rate-limited.

While not a critical attack surface, an attacker could enumerate or spam these endpoints. More importantly, the availability endpoint `GET /api/v1/availability` is rate-limited at 60 req/min, but courts endpoints are not covered. The NGINX `general` zone (120 req/min) provides a coarse limit, but it is not explicitly applied to these routes in the NGINX config.

This is a low severity item since courts data is public by design. The NGINX general rate limit provides adequate protection for V1.

**Advisory only — no required change, but must be explicitly noted in implementation.**

---

### ISSUE-009 — LOW: `audit_logs` Table Missing `payment_proof_viewed` Enum Value
**Document:** 05-database-architecture.md, Section 4.14; 12-storage-architecture.md, Section 4.1  
**Severity:** Low — implementation gap  
**Category:** Audit logging

The storage architecture (Doc 12) specifies:

```
4. Log access: audit_logs(action: 'payment_proof_viewed', proofId, adminId)
```

However, the `audit_action` enum defined in Doc 05 does not include `payment_proof_viewed`. The enum contains `payment_verified`, `payment_rejected` — but not a proof-viewing action.

**Fix required:** See Section 3, Required Change RC-007.

---

### ISSUE-010 — LOW: `must_change_password` Flag Referenced But Not in Schema
**Document:** 10-authentication-authorization-model.md, Section 2.5  
**Severity:** Low — implementation gap  
**Category:** Authentication

Doc 10 specifies: "Temporary passwords must be changed on first login (enforced by a `must_change_password` flag on the admin record)." However, the `admin_users` table in Doc 05 does not include this column.

This is a minor implementation gap — the spec text describes behaviour that cannot be implemented without the schema column.

**Fix required:** See Section 3, Required Change RC-007.

---

### ISSUE-011 — LOW: Default `expires_at` Value for `payment_submitted` Bookings
**Document:** 05-database-architecture.md, Section 4.9; 06-booking-state-machine.md, Section 8  
**Severity:** Low — schema clarity  
**Category:** Database

The bookings schema notes `expires_at: "set at creation; NULL once approved"`. The spec is silent on whether `expires_at` is set to `NULL` when a booking transitions from `pending` to `payment_submitted` (i.e., when the customer uploads proof).

If `expires_at` is kept as originally set (2 hours from creation), the expiry job would need to check: `status = 'pending' AND expires_at < NOW()`. That is what it does. Good.

But if a customer uploads proof at 1h 55m (5 minutes before expiry), the booking transitions to `payment_submitted` — but `expires_at` is still 5 minutes away. The expiry job only targets `pending`, so `payment_submitted` will not be expired. This is correct behaviour.

The ambiguity is: should `expires_at` be nulled out on transition to `payment_submitted`? The spec says NULL once approved. It should also say: set to NULL when transitioning from `pending` to `payment_submitted` (proof uploaded), to keep the field semantically clean.

**Advisory only — no blocking issue.**

---

### ISSUE-012 — ADVISORY: `X-Requested-With` Header Check Is Not Reliable CSRF Protection
**Document:** 10-authentication-authorization-model.md, Section 5.4  
**Severity:** Advisory — defence-in-depth gap  
**Category:** Security

The spec lists `X-Requested-With: XMLHttpRequest` as a CSRF protection measure. This is not reliable:

- The `fetch()` API does not automatically add `X-Requested-With` — the application code would have to add it explicitly.
- Some CDNs and proxies strip custom headers.
- `SameSite=Lax` is the primary CSRF defence and is strong for same-site form POSTs.

The spec already correctly identifies `SameSite=Lax` as the primary control. The `X-Requested-With` claim in Doc 10 should be replaced with the recommendation to ensure all admin mutations include the `Content-Type: application/json` header (which a cross-origin HTML form cannot set), which is already mentioned as a mitigation in Doc 13.

**Advisory only — the effective CSRF protection (SameSite=Lax + Content-Type check) is already specified. Just remove the misleading `X-Requested-With` claim.**

---

## 3. Required Changes

### RC-001 — Fix PostgreSQL Exclusion Constraint for `TIME` Columns
**Addresses:** ISSUE-001  
**Priority:** Critical — must be resolved before Milestone 0

The correct approach for excluding overlapping bookings where `booking_date` is `DATE` and `start_time`/`end_time` are `TIME` is to combine the date and time into a `tstzrange` at constraint evaluation time, or to store the booking as a full `tstzrange` column.

**Recommended solution — store a `booking_range` computed column:**

Add a generated column to `bookings` that combines `booking_date + start_time` and `booking_date + end_time` into a `TSTZRANGE` using the venue's fixed timezone (Africa/Cairo, UTC+2):

```sql
-- Add a generated/stored tstzrange column
ALTER TABLE bookings ADD COLUMN booking_range TSTZRANGE
    GENERATED ALWAYS AS (
        tstzrange(
            (booking_date + start_time) AT TIME ZONE 'Africa/Cairo',
            (booking_date + end_time)   AT TIME ZONE 'Africa/Cairo'
        )
    ) STORED;

-- Exclusion constraint on this column
ALTER TABLE bookings ADD CONSTRAINT no_overlapping_approved_bookings
    EXCLUDE USING GIST (
        court_id      WITH =,
        booking_range WITH &&
    ) WHERE (status = 'approved');
```

**Why this works:**
- `TSTZRANGE` is a native PostgreSQL range type.
- `btree_gist` supports `TSTZRANGE WITH &&` (overlap operator) in exclusion constraints.
- The `STORED` generated column is persisted and indexed automatically.
- Combining date and time into a single range eliminates the midnight-crossing edge case.
- The timezone conversion is done consistently at the database level.

**Alternative approach (simpler, no generated column):**

If generated columns add implementation complexity, use a partial unique index approach plus the application-level `SELECT FOR UPDATE` check as the sole concurrency guard, and document clearly that the database-level exclusion constraint is application-enforced only. This is acceptable for V1 given the low concurrent load, but the `booking_range` approach is strongly preferred.

**Verify `btree_gist` availability in Milestone 0 before choosing the approach.**

---

### RC-002 — Make File Upload Outcome Consistent with Booking State
**Addresses:** ISSUE-002  
**Priority:** High — must be resolved before Milestone 1

The booking creation flow must handle the file upload either atomically or with a clear fallback.

**Recommended solution:**

Split the booking creation into two explicit phases:

**Phase 1 (in transaction):** Create booking (`pending`) + payment record (`pending`) + customer (upsert). Return booking reference immediately. This is fast and uses the ACID transaction correctly.

**Phase 2 (after transaction, if file present):** Upload file. If upload succeeds, update payment and booking status within a new short transaction. If upload fails, the booking remains `pending` — the customer is shown the booking reference and the status message "Awaiting payment proof. You can upload your proof at any time using your booking reference."

This makes the file upload a non-blocking optional step at creation time, consistent with the existing late-upload mechanism. The key change:

```
Instead of:
  "Upload failed → ambiguous state"

Use:
  "Upload is always a best-effort post-creation step.
   On failure, booking is pending and customer can re-upload.
   Customer always receives their reference."
```

The confirmation screen should reflect the actual state:
- If proof uploaded successfully: "Payment Submitted – Under Review"
- If proof upload failed or was skipped: "Booking received – please upload your payment proof"

This is consistent with the already-specified late upload mechanism and removes the orphaned-state failure mode.

**The spec already supports this design** — the late upload endpoint exists. The only change is making the initial-submission flow explicitly non-atomic regarding the file, and providing clear user feedback when the upload step fails.

---

### RC-003 — Add `booking_ref_prefix` to `venues` Table
**Addresses:** ISSUE-003  
**Priority:** High — must be in the schema from day one

Add a `booking_ref_prefix` column to the `venues` table:

```sql
ALTER TABLE venues ADD COLUMN booking_ref_prefix VARCHAR(10) NOT NULL DEFAULT 'TF';
```

The booking reference generator must read this prefix from the venue record, not from a code constant. In V1, the only venue has `booking_ref_prefix = 'TF'`. In future, each venue has its own prefix (e.g., `'CC'` for Club Cairo).

This is a two-line schema change that eliminates the hardcoded prefix debt entirely before it becomes a migration problem with populated data.

**Update the booking reference generator:**
```typescript
// Instead of: const prefix = 'TF'
const prefix = venue.booking_ref_prefix  // sourced from DB
```

---

### RC-004 — Document and Test the Pending Booking Race Condition
**Addresses:** ISSUE-005  
**Priority:** Medium — must be documented before Milestone 1 testing

The spec must explicitly state:

> "Two concurrent requests can each create a `pending` booking for the same slot. This is accepted behaviour in V1. The slot appears unavailable to further customers (both pending bookings hold it). When one booking reaches `approved`, the exclusion constraint prevents the other from also being approved. The admin must reject the second booking manually. This is the expected operating procedure."

**Required additions to the specification:**

1. Add this statement to Doc 06 (Booking State Machine), Section 5 (Allowed Transitions).
2. Add a test case to Doc 14 (Testing Strategy): "Two simultaneous pending booking creation requests for the same slot can both succeed. Verify that only one can reach `approved` state."
3. Add an admin UI note to Doc 08 (Admin Workflow): "If two bookings exist for the same slot, the second cannot be approved after the first is approved. The admin will see the conflict error and must reject the second booking."

---

### RC-005 — Fix the `chk_booking_date_future` Constraint for Timezone
**Addresses:** ISSUE-006  
**Priority:** Medium — must be resolved before Milestone 0

**Option A (recommended):** Remove the `CHECK (booking_date >= CURRENT_DATE)` constraint entirely. The application layer already validates that `booking_date` is not in the past. The DB constraint is a secondary guard but causes incorrect rejections due to UTC vs EGT timezone difference. Removing it from the DB does not weaken security — the service layer validation remains.

**Option B:** Use a timezone-aware comparison:

```sql
CONSTRAINT chk_booking_date_future CHECK (
    booking_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::DATE
)
```

This compares against today's date in Egypt time, not UTC. This is correct.

**Option A is recommended** for simplicity. The application validates dates, the constraint is belt-and-suspenders and is causing real operational issues. Remove it from the DB schema, keep validation in the service layer.

---

### RC-006 — Fix the `uq_court_name_per_venue` Partial Unique Index
**Addresses:** ISSUE-007  
**Priority:** Medium — must be resolved before Milestone 0

Replace the UNIQUE constraint with a partial unique index that correctly handles NULLs:

```sql
-- Remove the broken UNIQUE constraint:
-- CONSTRAINT uq_court_name_per_venue UNIQUE (venue_id, name, deleted_at)

-- Add a correct partial unique index instead:
CREATE UNIQUE INDEX uq_court_name_per_venue_active
    ON courts (venue_id, name)
    WHERE deleted_at IS NULL;
```

This index only covers active (non-deleted) courts, correctly enforcing that no two active courts in the same venue can share a name. Soft-deleted courts are excluded, allowing a new court to reuse a name from a deleted one (which is the desired behaviour).

---

### RC-007 — Schema Additions: `payment_proof_viewed` Audit Enum + `must_change_password` Column
**Addresses:** ISSUE-009 and ISSUE-010  
**Priority:** Low — must be in the schema before implementation

**Addition 1 — Audit log enum:**
```sql
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_proof_viewed';
```

Add to the `audit_action` enum in Doc 05.

**Addition 2 — Admin users column:**
```sql
ALTER TABLE admin_users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
```

Add to the `admin_users` table definition in Doc 05. The seed script must set this to `TRUE` for newly created temporary-password accounts and `FALSE` for the initial super-admin.

---

## 4. Security Findings

### SF-001: Payment Workflow — Authorization Is Correctly Specified ✓

Every mechanism described in the review prompt has been verified:

| Security Requirement | Specification Status |
|---------------------|---------------------|
| Browser cannot set payment status to `verified` | ✓ Verified — payment status is only set by service functions, never from request body |
| Browser cannot set booking status to `approved` | ✓ Verified — status is only set server-side via state machine |
| Browser cannot change authoritative booking price | ✓ Verified — price field is not in the booking creation schema; server calculates from DB |
| Browser cannot approve a booking | ✓ Verified — approve endpoint requires admin session + `approve_booking` permission |
| Browser cannot verify a payment | ✓ Verified — verify requires admin session + `verify_payment` permission |
| Customer cannot modify another customer's booking | ✓ Verified — every customer booking query and mutation is scoped to the authenticated session's `customer_account_id` |

### SF-002: Admin API Authorization Matrix ✓

All admin routes reviewed:

| Endpoint | Auth Required | Permission | IDOR Check | Audit Log |
|----------|--------------|-----------|------------|-----------|
| `POST /admin/bookings/:id/approve` | ✓ iron-session | `approve_booking` + `verify_payment` | ✓ venue_id scope | ✓ two entries |
| `POST /admin/bookings/:id/reject` | ✓ | `reject_booking` | ✓ | ✓ |
| `POST /admin/bookings/:id/cancel` | ✓ | `cancel_booking` | ✓ | ✓ |
| `POST /admin/courts` | ✓ | `manage_courts` | ✓ venue_id from config | ✓ |
| `POST /admin/pricing` | ✓ | `manage_pricing` | ✓ | ✓ |
| `PUT /admin/schedule/hours` | ✓ | `manage_schedule` | ✓ | ✓ |
| `POST /admin/administrators` | ✓ | `manage_admins` | ✓ | ✓ |
| `GET /admin/audit-logs` | ✓ | `view_audit_logs` | ✓ | N/A (read-only) |
| `GET /admin/bookings/:id/proofs/:id/view` | ✓ | `view_payment_proof` | ✓ | ✓ (proof_viewed) |
| `PUT /admin/cms/settings` | ✓ | `manage_cms` | ✓ venue_id from config | ✓ |

**No endpoint is missing authentication or permission checking in the specification.**

### SF-003: IDOR Prevention — Correctly Specified ✓

- Customer-facing booking lookup: requires the owning authenticated customer session and exposes no UUIDs. ✓
- Admin booking detail: loads booking and verifies `booking.venue_id === server_venue_id`. ✓
- Payment proof access: verifies proof belongs to a booking in the venue. ✓
- Admin endpoints scoped to `VENUE_ID` from env var, not from client request. ✓

### SF-004: File Upload Security — Correctly Specified ✓

| Control | Specified |
|---------|----------|
| Max size 10MB | ✓ |
| MIME type validated via magic bytes (file-type library) | ✓ |
| Extension validated against detected MIME | ✓ |
| SVG excluded | ✓ |
| Server-generated ULID filename | ✓ |
| Stored in private bucket (no public access) | ✓ |
| Served only via short-lived signed URL (5 min) | ✓ |
| No filesystem execution path | ✓ (object storage only) |
| No path traversal | ✓ (ULID keys, no user input in path) |
| Upload audit trail | ✓ (payment_proofs table) |
| Admin proof access audit | ✓ (payment_proof_viewed — after RC-007) |

### SF-005: CSRF Protection — Partially Correct

`SameSite=Lax` on the admin session cookie is the correct primary defence. The `X-Requested-With` claim (ISSUE-012) should be corrected but does not represent a real gap because `SameSite=Lax` is already specified. Customer booking form CSRF token is specified correctly.

### SF-006: Mass Assignment Prevention ✓

The Zod schema approach ensures only explicitly listed fields are accepted. The booking creation schema does not include `priceAmount`, `status`, `approvedBy`, or any server-managed field. No mass assignment vulnerability exists in the specified design.

---

## 5. Booking Integrity Findings

### BIF-001: Exclusion Constraint Scope Analysis

The exclusion constraint (after RC-001 fix) covers `status = 'approved'` only. The following analysis confirms all scenarios are handled correctly:

| Scenario | Handled By | Verdict |
|----------|-----------|---------|
| Same court + same time, both `approved` | Exclusion constraint | ✓ Impossible at DB level |
| Same court + overlapping time, both `approved` | Exclusion constraint (tstzrange `&&`) | ✓ Impossible at DB level |
| Same court + adjacent time (19:00–20:00 and 20:00–21:00) | `&&` operator: adjacent ranges do not overlap | ✓ Both allowed |
| Different courts + same time | Exclusion uses `court_id WITH =` — different courts not constrained | ✓ Correctly allowed |
| Different dates | tstzrange comparison — different dates don't overlap | ✓ Correctly allowed |
| `cancelled` booking + new `approved` booking, same slot | Constraint is `WHERE status = 'approved'` only. Cancelled not included | ✓ Slot correctly freed |
| `rejected` booking + new `approved` booking, same slot | Same — rejected not included | ✓ Slot correctly freed |
| `expired` booking + new `approved` booking, same slot | Same — expired not included | ✓ Slot correctly freed |
| Two `pending` bookings for same slot | Not covered by exclusion constraint | ⚠ Documented in RC-004 |
| `pending` + `approved` for same slot | Not covered by exclusion constraint (different states) | ✓ Application-level check during approval will catch and reject |

### BIF-002: Concurrent Approval by Two Admins ✓

The scenario is correctly handled:

1. Admin A and Admin B both attempt to approve the same booking simultaneously.
2. `SELECT ... FOR UPDATE` inside a SERIALIZABLE transaction serialises the updates.
3. Admin A's transaction commits first; booking is now `approved`.
4. Admin B's transaction loads the booking; `assertTransitionAllowed('approved', 'approved', 'admin')` throws → HTTP 422.

**Verdict:** Correctly specified. Two admins cannot double-approve the same booking.

### BIF-003: Two Admins Approving Different Bookings for the Same Slot ✓

1. Admin A approves Booking X (Court 1, 20:00–21:00). Exclusion constraint now active for that slot.
2. Admin B approves Booking Y (same slot). PostgreSQL raises `exclusion_violation (23P01)`.
3. Application catches error code `23P01`, returns HTTP 409 with conflict message.

**Verdict:** Correctly specified. The exclusion constraint is the final safety net.

### BIF-004: Pending-to-Approved Availability Re-Check ✓

Both Doc 04 and Doc 08 specify that the approval transaction performs a fresh `SELECT ... FOR UPDATE` to check for conflicts before committing. This is the correct pattern. The check uses the current database state — not the state that was visible when the admin opened the booking detail page. Stale-read attacks (opening the detail page, waiting for another booking to be approved, then clicking Approve) are prevented by the transaction-level check and the exclusion constraint backstop.

### BIF-005: Expiry Logic — Only `pending` Bookings Expire ✓

Confirmed: the expiry job targets `status = 'pending'` only. `payment_submitted` and `under_review` do not expire automatically. This is a deliberate design choice documented in the spec. ISSUE-004 has been raised as a business policy item for the venue owner to explicitly accept.

---

## 6. Database Findings

### DBF-001: Missing Index for Admin Bookings List Query
**Severity:** Low  

The admin bookings list endpoint filters by `status`, `court_id`, `booking_date` range, and searches by `customer_account_id`. The existing indexes cover `(court_id, booking_date)` and `status` individually, but the combined admin query:

```sql
WHERE venue_id = $1
  AND status = ANY($2)
  AND booking_date BETWEEN $3 AND $4
```

would benefit from a composite index:

```sql
CREATE INDEX idx_bookings_admin_list
    ON bookings (venue_id, status, booking_date DESC)
    WHERE deleted_at IS NULL;
```

This is an advisory performance recommendation for implementation, not a blocking schema issue.

### DBF-002: All Required Changes From RC-001 Through RC-007 Applied ✓ (after fixes)

After applying all seven required changes, the database schema will be:
- Functionally correct (exclusion constraint fixed, unique constraint fixed)
- Complete (missing enum value and column added)
- Timezone-safe (booking date constraint fixed)
- Future-ready (booking reference prefix in venues table)

### DBF-003: PostgreSQL Role Permissions Are Well-Designed ✓

The `app_user` role cannot DELETE from `bookings`, `payment_records`, `payment_proofs`, or UPDATE/DELETE `audit_logs`. This is correct and provides defense-in-depth against application layer exploitation. The `migration_user` separation is also correct.

### DBF-004: `operating_hours` Table Has No `deleted_at` Column
**Severity:** Advisory  

Unlike courts and pricing rules, `operating_hours` has no soft delete. This is correct — operating hours are replaced in-place (upserted). However, there is no audit trail of what the previous operating hours were if they are changed. The CMS update audit log records `old_value` / `new_value` JSON, which covers this. Verdict: acceptable, no change needed.

### DBF-005: Payment Record Amount vs. Booking Price Duplication
**Severity:** Advisory  

`payment_records.amount` and `bookings.price_amount` should always be identical (the payment is for the booking). The schema does not enforce this at the database level (no `CHECK` constraint linking them). This is acceptable — the application creates both in the same transaction, setting `payment_records.amount = calculatedPrice` and `bookings.price_amount = calculatedPrice`. The redundancy is intentional for future extensibility (partial payments, refunds).

---

## 7. CMS Findings

### CMSF-001: All Required Content Is Database-Backed ✓

The following items are verified as CMS-managed (not hardcoded):

| Content | CMS Mechanism | Verified |
|---------|--------------|---------|
| The Field name | `venue.name` key in `cms_site_settings` | ✓ |
| Description | `about.body` key | ✓ |
| Logo | Handled via `venues` table or CMS image key | ✓ |
| Gallery images | `cms_gallery_items` table | ✓ |
| Courts | `courts` table, admin-managed | ✓ |
| Court prices | `court_pricing_rules` table | ✓ |
| Opening hours | `operating_hours` table | ✓ |
| FAQs | `cms_faqs` table | ✓ |
| Events | `cms_events` table | ✓ |
| Announcements | `cms_announcements` table | ✓ |
| Contact information | `contact.*` keys in `cms_site_settings` | ✓ |
| WhatsApp number | `venue.whatsapp` key | ✓ |
| Social media links | `cms_social_links` table | ✓ |
| SEO metadata | `seo.*` keys | ✓ |
| InstaPay number | `venue.instapay_number` key | ✓ |

**Nothing critical is hardcoded.**

### CMSF-002: Logo Is Not Explicitly in the CMS Key Inventory
**Severity:** Low — advisory  

The CMS key inventory in Doc 09 does not include a key for the venue's logo image. The logo is referenced on FR-CUS-004 ("website must display The Field's name, logo, and branding"). If the logo is a static file (e.g., uploaded once during deployment and stored as a static Next.js asset), that is acceptable. If the admin should be able to change the logo without redeployment, a `venue.logo_key` CMS setting should be added.

**Recommendation:** Add `venue.logo_key` to the CMS key inventory as a `P2` item. For V1 launch, a static logo file is acceptable if the venue owner confirms the logo will not change.

### CMSF-003: Multi-Venue Concerns Are Not Visible in V1 CMS UI ✓

The admin CMS interface is presented as The Field's settings throughout. No venue selector, no venue list, no marketplace language. All content is naturally scoped to the single venue. The `venue_id` column is invisible to the admin — it is set from the server-side `VENUE_ID` config. This is correct for V1.

### CMSF-004: Cache Invalidation on `reorderFaqs` Not Specified
**Severity:** Low — advisory  

The CMS cache invalidation section (Doc 09) calls `revalidateTag('cms-{venueId}')` on CMS updates. The `reorderFaqs` service function in the function contract also calls the admin ID for audit, but the cache invalidation call must be confirmed in the implementation for reorder operations. This is an implementation-level reminder, not a specification gap.

---

## 8. Deployment Findings

### DF-001: Stack Is Practical for Hostinger VPS ✓

Every component in the specified stack runs well on a standard Ubuntu 22.04 Hostinger VPS:

| Component | Hostinger Compatibility | Notes |
|-----------|------------------------|-------|
| Node.js 20 LTS | ✓ Full install via NodeSource | Standard |
| Next.js 14 | ✓ | Runs on Node.js 20 |
| PostgreSQL 16 | ✓ Available in Ubuntu 22.04 repos | Self-managed |
| NGINX | ✓ | Standard Ubuntu package |
| PM2 | ✓ | npm global install |
| Certbot | ✓ | Standard Ubuntu package |
| Cloudflare R2 | ✓ External service, no VPS config | Just env vars |
| Sentry | ✓ External service | Just env vars |

**No component requires Kubernetes, Docker Swarm, or managed orchestration.** The stack is appropriate for the scale.

### DF-002: PostgreSQL `btree_gist` Extension on Hostinger
**Severity:** Medium — must verify in Milestone 0  

The `btree_gist` extension is included in the `postgresql-contrib` package on Ubuntu:

```bash
apt install postgresql-16-contrib
```

On a self-managed Hostinger VPS with a self-installed PostgreSQL, this package is available and the extension can be created. On a **managed** Hostinger database service, extension availability depends on the service plan and must be confirmed before beginning Milestone 0.

**Action:** Make verifying `btree_gist` availability the very first task of Milestone 0, before any other schema work.

### DF-003: `pm2 reload` Is Not Truly Zero-Downtime Without Multiple Instances
**Severity:** Low — advisory  

`pm2 reload` in fork mode (single instance) performs a graceful reload by starting the new process, waiting for it to be ready (listening on the port), then killing the old one. In practice, this takes 2–5 seconds during which NGINX may return 502 errors to in-flight requests.

For V1 at low traffic volumes, this is acceptable. The spec's claim of "zero-downtime reload" is slightly optimistic — it is near-zero, not truly zero. This should be noted in the operations documentation.

### DF-004: Backup Credential Is `app_user` But Should Be `backup_user`
**Severity:** Low — security hygiene  

The backup script in Doc 15 uses `pg_dump -U app_user`. For least-privilege, the backup should use a dedicated `backup_user` role with SELECT-only permissions, not the application user. This is a minor security hygiene improvement:

```sql
CREATE ROLE backup_user LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE thefield TO backup_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_user;
```

The `app_user` would work, but using the application credentials for backups means a compromised backup credential equals application access.

### DF-005: GitHub Actions SSH Deployment Is Practical but Needs Known-Hosts
**Severity:** Low — advisory  

The GitHub Actions deployment uses `appleboy/ssh-action`. This requires the VPS host key to be pre-registered in GitHub Secrets as `VPS_SSH_KEY`. The workflow should also include a `known_hosts` entry or use strict host key checking to prevent MITM attacks during deployment. This is a standard SSH deployment consideration, not a specification gap.

---

## 9. Open Business Decisions

The following are unresolved business policy decisions that **require confirmation from The Field venue owner before development begins**. Default values have been applied in the spec but explicitly noted as provisional. Development must not begin on features that depend on these decisions without confirmation.

### OBD-001: Cancellation Policy
**Status:** UNRESOLVED — Default applied: customers cannot self-cancel  
**Why it matters technically:**  
- If customers can self-cancel, a `cancel_booking` API route must exist for the customer-facing side (not just admin).
- The booking state machine must include a `pending → cancelled` or `approved → cancelled` transition for the `customer` actor.
- Customer-facing cancellation likely requires time-limit rules (e.g., "can only cancel up to 2 hours before booking time").
- This requires a new service function, new API endpoint, and new acceptance criteria.

**If left as "admin-only cancel":** No additional implementation required beyond what is specified.  
**If customers can cancel:** Estimate 2–3 days additional implementation work in Milestone 3.

**Decision needed from:** Venue Owner  
**Decision needed before:** Milestone 3 (Admin Authentication and Booking Management)

---

### OBD-002: Pending Booking Expiry Timeout
**Status:** UNRESOLVED — Default applied: 2 hours  
**Why it matters technically:**  
- The `BOOKING_EXPIRY_MINUTES=120` environment variable controls this.
- A shorter timeout (e.g., 30 minutes) reduces slot blocking but gives customers less time to transfer and screenshot InstaPay.
- A longer timeout (e.g., 4 hours) is more customer-friendly but means a slot can be held for half a day by a non-paying customer.
- The timeout value also affects how long the availability calendar appears "full" when a slot has a pending booking.

**Recommended conversation with venue owner:** "If a customer says they will pay but doesn't upload proof, how long do you want to hold the court for them before releasing it to someone else?"

**This is purely a configuration setting** — no code change is required, only environment variable documentation.

**Decision needed from:** Venue Owner  
**Decision needed before:** Milestone 1 seed configuration

---

### OBD-003: Language Support for Version 1
**Status:** UNRESOLVED — Default applied: English only  
**Why it matters technically:**  

This is the most impactful open decision. The implications span:

| If English only | If Arabic only | If Bilingual |
|----------------|----------------|-------------|
| No i18n library needed | Arabic requires RTL layout | `next-intl` or `i18next` required |
| No RTL CSS | Tailwind needs `rtl:` prefixes throughout | Both language sets needed |
| Fastest to build | Customer-friendly for Egyptian market | Most complex, 2–4 weeks extra work |
| May feel foreign to some customers | | |

**Architectural note:** The spec correctly states the HTML `lang` attribute and font choices must support future Arabic. However, if Arabic is required for V1 launch, the entire booking flow, error messages, confirmation screens, and admin-facing content must be in Arabic (or bilingual). This is not a minor addition — it affects every UI component.

**The spec currently makes no RTL provisions in the CSS architecture.** If Arabic is required, Tailwind's RTL support (`rtl:` variants) and a logical properties approach must be added to the design system in Milestone 2.

**Recommendation to venue owner:** "Given your customer base is Egyptian, do you want the website to be in Arabic, English, or both? This decision significantly affects how long the UI takes to build."

**Decision needed from:** Venue Owner  
**Decision needed before:** Milestone 2 (Customer-Facing UI) begins

---

### OBD-004: Exact Operating Schedule
**Status:** UNRESOLVED — Default applied: daily 08:00–24:00  
**Why it matters technically:**  
- The operating hours seed data in Milestone 0 must use the real schedule.
- If the venue is closed on Fridays (for example), the date picker must reflect this from day one.
- Incorrect seed data means the first test bookings will show wrong availability.

**This requires only a configuration change** (database seed), not code changes. But it must be provided before Milestone 0 seeding.

**Decision needed from:** Venue Owner  
**Decision needed before:** Milestone 0 seed script

---

### OBD-005: Indefinite Soft-Hold for `payment_submitted` Bookings
**Status:** ADVISORY — Default behaviour: no automatic expiry for `payment_submitted`  
**Why it matters technically:**  

As documented in ISSUE-004: a `payment_submitted` booking holds its slot indefinitely until an admin takes action. If the admin is unavailable for an extended period, slots remain held.

The venue owner should be informed: **"If a customer uploads a payment proof but your team doesn't check the system for 3 days, that court slot is blocked for 3 days."**

If the venue wants automatic release after a configurable period (e.g., 48 hours with no admin action), a separate expiry rule for `payment_submitted` bookings must be added.

**Decision needed from:** Venue Owner  
**Decision needed before:** Milestone 1

---

## 10. Final Recommended Architecture

The architecture is confirmed as sound with the following refinements applied:

### Application Architecture
**Confirmed:** Next.js 14 App Router, modular monolith, single VPS, TypeScript throughout.

No changes to the overall architecture. The module boundaries, layer responsibilities, and dependency graph are correctly designed.

### Database Architecture
**Changes applied:**
1. RC-001: `booking_range TSTZRANGE GENERATED ALWAYS AS (...) STORED` column with `EXCLUDE USING GIST (court_id WITH =, booking_range WITH &&) WHERE (status = 'approved')`.
2. RC-003: `booking_ref_prefix VARCHAR(10) NOT NULL DEFAULT 'TF'` on `venues`.
3. RC-005: Remove `chk_booking_date_future` constraint. Validate in service layer only.
4. RC-006: Replace `CONSTRAINT uq_court_name_per_venue UNIQUE (venue_id, name, deleted_at)` with `CREATE UNIQUE INDEX uq_court_name_per_venue_active ON courts (venue_id, name) WHERE deleted_at IS NULL`.
5. RC-007a: Add `payment_proof_viewed` to `audit_action` enum.
6. RC-007b: Add `must_change_password BOOLEAN NOT NULL DEFAULT FALSE` to `admin_users`.
7. Advisory: Add `CREATE INDEX idx_bookings_admin_list ON bookings (venue_id, status, booking_date DESC) WHERE deleted_at IS NULL`.

### Booking Engine Architecture
**Confirmed with one documentation addition (RC-004):** The two-layer concurrency guard (application-level SELECT FOR UPDATE + database-level exclusion constraint) is correct. The pending-booking race condition is documented and accepted.

### File Upload Architecture
**Clarified (RC-002):** File upload is a best-effort post-creation step. Booking creation always succeeds first; file upload is non-blocking. Customer receives booking reference regardless of file upload outcome.

### Security Architecture
**Confirmed:** All specified security controls are correctly designed. Remove `X-Requested-With` claim from CSRF section (advisory, not blocking).

### CMS Architecture
**Confirmed with one advisory addition:** Add `venue.logo_key` as a P2 CMS setting.

---

## 11. Final Technology Stack

The specified stack is confirmed. No changes.

| Layer | Technology | Version | Status |
|-------|-----------|---------|--------|
| Frontend framework | Next.js | 14.x | ✓ Confirmed |
| Language | TypeScript | 5.x | ✓ Confirmed |
| Styling | Tailwind CSS | 3.x | ✓ Confirmed |
| Database | PostgreSQL | 16 | ✓ Confirmed |
| ORM | Drizzle ORM | Latest stable | ✓ Confirmed |
| Authentication | iron-session | Latest stable | ✓ Confirmed |
| Password hashing | bcrypt | Latest stable | ✓ Confirmed |
| Input validation | Zod | 3.x | ✓ Confirmed |
| File upload | formidable or built-in | — | ✓ Confirmed |
| MIME detection | file-type | Latest stable | ✓ Confirmed |
| Image optimization | sharp | Latest stable | ✓ Confirmed |
| Object storage | Cloudflare R2 (primary) | — | ✓ Confirmed |
| Storage SDK | @aws-sdk/client-s3 | Latest stable | ✓ Confirmed |
| Background jobs | node-cron | Latest stable | ✓ Confirmed |
| Unit testing | Vitest | Latest stable | ✓ Confirmed |
| E2E testing | Playwright | Latest stable | ✓ Confirmed |
| Error monitoring | Sentry | Latest stable | ✓ Confirmed |
| Structured logging | pino | Latest stable | ✓ Confirmed |
| Process manager | PM2 | 5.x | ✓ Confirmed |
| Reverse proxy | NGINX | 1.24+ | ✓ Confirmed |
| TLS | Let's Encrypt / Certbot | Latest | ✓ Confirmed |
| Rate limiting | rate-limiter-flexible | Latest stable | ✓ Confirmed |
| Uptime monitoring | UptimeRobot | — | ✓ Confirmed |

**One minor addition:**

| Layer | Technology | Reason |
|-------|-----------|--------|
| HTML sanitization | sanitize-html | CMS "About" body sanitization (already referenced in spec, just not in the stack table) |

---

## 12. Final Implementation Order

The milestone order from Doc 18 is confirmed as correct. The following changes are applied:

### Milestone 0 Additions (Foundation)
Execute in this exact order before any other milestone begins:

1. **FIRST:** Run `CREATE EXTENSION IF NOT EXISTS btree_gist;` on the target PostgreSQL instance (Hostinger or local). If this fails on Hostinger managed database, resolve before proceeding.
2. Apply all 7 Required Changes (RC-001 through RC-007) to the Drizzle schema file.
3. Resolve OBD-004 (operating schedule) with venue owner — required for the seed script.
4. Write and verify the initial migration, including the `booking_range` generated column and corrected exclusion constraint.
5. All other Milestone 0 tasks as specified.

### Pre-Milestone 2 Gate
Before beginning the Customer-Facing UI:

- **OBD-003 (language decision) must be resolved.** If Arabic or bilingual is required, the Tailwind configuration and component library must include RTL support from the start. Adding RTL after components are built is significantly more expensive.

### Pre-Milestone 3 Gate
Before beginning Admin dashboard:

- **OBD-001 (cancellation policy) must be resolved** if customer self-cancellation is required. This affects the booking state machine implementation.

### Milestone 1 Addition
Add to Milestone 1 testing tasks:

- Integration test: "Two simultaneous `pending` booking creation requests for the same slot can both create pending bookings. Verify only one can be approved." (RC-004)
- Integration test: "File upload failure during booking creation leaves booking in `pending` state; customer reference is still returned." (RC-002)

### No Other Milestone Ordering Changes
The existing milestone sequence is optimal: engine first, UI second, admin third, management fourth, CMS fifth, hardening sixth.

---

## 13. Definition of Done for Version 1

The following criteria must ALL be satisfied before Version 1 is considered complete and production-ready.

### Code Completeness
- [ ] All P1 functional requirements (FR-*) implemented and verifiable
- [ ] All 7 Required Changes (RC-001 through RC-007) applied to the schema
- [ ] All open business decisions (OBD-001 through OBD-004) resolved and implemented per the venue owner's answers
- [ ] No hardcoded venue name, InstaPay number, phone number, or price in source code
- [ ] All CMS-managed content sourced from database at runtime
- [ ] Booking reference prefix sourced from `venues.booking_ref_prefix`, not a code constant
- [ ] Booking price sourced from `court_pricing_rules`, never from client request
- [ ] File upload is non-blocking: booking creation succeeds independently of file upload outcome

### Database Completeness
- [ ] `btree_gist` extension installed and verified
- [ ] `booking_range` generated column present on `bookings` table
- [ ] Exclusion constraint `no_overlapping_approved_bookings` on `(court_id WITH =, booking_range WITH &&)` active and tested
- [ ] Partial unique index `uq_court_name_per_venue_active` replacing the broken UNIQUE constraint
- [ ] `must_change_password` column present on `admin_users`
- [ ] `payment_proof_viewed` value present in `audit_action` enum
- [ ] `booking_ref_prefix` column present on `venues`
- [ ] All indexes from Doc 05 plus the admin list composite index deployed
- [ ] All DB-level REVOKE statements applied (no DELETE on bookings/payments; no UPDATE/DELETE on audit_logs)
- [ ] Seed script populated with real operating hours from venue owner (OBD-004)

### Security Completeness
- [ ] HTTPS enforced with HTTP → HTTPS redirect
- [ ] HSTS header with preload
- [ ] TLS 1.2 minimum (1.3 preferred)
- [ ] All security headers set (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- [ ] securityheaders.com scan result: grade B or above
- [ ] Admin session cookie: HttpOnly, Secure, SameSite=Lax, Path=/admin
- [ ] Brute-force protection: 5 failures per IP per 15 minutes → lockout
- [ ] Semgrep static scan: 0 high findings
- [ ] npm audit: 0 critical/high CVEs
- [ ] gitleaks scan: 0 secrets in git history
- [ ] OWASP ZAP baseline scan: 0 high/critical findings
- [ ] Burp Suite manual review of booking flow, admin approval, file upload completed
- [ ] Payment proof files inaccessible without admin session + signed URL
- [ ] All admin API routes verified: session check + permission check present

### Testing Completeness
- [ ] Unit test coverage ≥ 85% for booking engine, price calculator, availability, state machine
- [ ] Unit test coverage ≥ 80% for permission checks
- [ ] Integration test: concurrent booking (10 simultaneous → exactly 1 succeeds)
- [ ] Integration test: two admins approving same slot → one succeeds, one gets HTTP 409
- [ ] Integration test: price manipulation → server stores correct price
- [ ] Integration test: file upload failure → booking remains in `pending`, reference returned
- [ ] Integration test: booking expiry job correctly expires only `pending` bookings
- [ ] Integration test: direct SQL INSERT of overlapping approved booking → PostgreSQL raises 23P01
- [ ] E2E test: full customer booking flow on 390px mobile viewport
- [ ] E2E test: IDOR attempt (a different authenticated account requests a valid reference → not found)
- [ ] E2E test: admin full approval workflow
- [ ] E2E test: unauthenticated access to /admin → redirect to login
- [ ] E2E test: viewer role cannot approve → HTTP 403
- [ ] E2E test: CMS change reflected on public site after cache invalidation

### Operational Completeness
- [ ] PM2 configured with `pm2 startup` and `pm2 save` — verified by simulating a reboot on staging
- [ ] Database backup script running and verified: test restore completed successfully
- [ ] UptimeRobot monitor active — tested by temporarily stopping the server
- [ ] Sentry receiving production errors — verified with a test exception
- [ ] BOOKING_EXPIRY_MINUTES env var set per OBD-002 owner decision
- [ ] InstaPay number configured in CMS settings (not seeded as a default)
- [ ] Admin seed credentials changed from defaults before any real data entry
- [ ] `.env.example` complete with all variables and descriptions
- [ ] No `.env` files with real credentials anywhere in the repository
- [ ] README complete with: setup, migration, deployment, and operations documentation
- [ ] Admin onboarding guide written: how to approve a booking, manage pricing, manage schedule
- [ ] Privacy policy page live

### Acceptance
- [ ] All P1 Acceptance Criteria from Doc 19 pass on the production environment
- [ ] Venue owner has manually placed a real test booking and confirmed the admin approval workflow
- [ ] Lighthouse mobile performance score ≥ 85 on home page and booking page
- [ ] The venue owner or a designated non-technical administrator has been able to: change the InstaPay number, add an FAQ, block a date, and update the operating hours — without developer assistance

---

## Appendix: Change Summary for Specification Updates

The following documents require updates based on this review:

| Document | Changes Required | Priority |
|----------|-----------------|---------|
| 05-database-architecture.md | RC-001: Fix exclusion constraint (booking_range generated column) | Critical |
| 05-database-architecture.md | RC-003: Add booking_ref_prefix to venues | High |
| 05-database-architecture.md | RC-005: Remove chk_booking_date_future constraint | Medium |
| 05-database-architecture.md | RC-006: Replace UNIQUE constraint with partial unique index on courts | Medium |
| 05-database-architecture.md | RC-007a: Add payment_proof_viewed to audit_action enum | Low |
| 05-database-architecture.md | RC-007b: Add must_change_password to admin_users | Low |
| 05-database-architecture.md | Advisory: Add idx_bookings_admin_list composite index | Low |
| 04-system-architecture.md | RC-001: Fix tsrange reference in concurrency section | Critical |
| 04-system-architecture.md | RC-002: Clarify file upload is non-blocking, post-creation | High |
| 06-booking-state-machine.md | RC-004: Document pending booking race condition explicitly | Medium |
| 10-authentication-authorization-model.md | SF-005: Remove X-Requested-With claim, replace with Content-Type check note | Advisory |
| 01-product-requirements-document.md | OBD-001 through OBD-005: Remove default values; mark as requiring owner confirmation | Required |
| 00-index.md | Update open questions table to reflect OBD status | Required |

---

*Architecture Review Report — The Field V1 — August 31, 2026*  
*Review conducted by: Lead Software Architect / Senior Security Engineer / QA Architect*  
*Next action: Apply required changes to specification documents, then confirm open business decisions with venue owner before development begins.*
