# Admin Workflow
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. Overview

This document defines every workflow an administrator performs in the dashboard. It specifies the screens involved, the actions available at each step, the server-side validation required, and the audit trail produced.

The admin dashboard is a protected Next.js route group (`/admin/**`). Every route in this group is guarded by a server-side session check. Unauthenticated requests are redirected to `/admin/login`.

---

## 2. Administrator Login Workflow

```
Navigate to /admin/login
        │
        ▼
Enter email + password
        │
        ▼
POST /api/v1/admin/auth/login
  │
  ├── Rate limit check: max 5 attempts per IP per 15 minutes
  │     → If exceeded: HTTP 429, lockout message, no timing difference between
  │       valid/invalid credentials (constant-time response)
  │
  ├── Validate input schema (email format, password non-empty)
  │
  ├── Load admin_users record by email WHERE deleted_at IS NULL AND is_active = TRUE
  │     → If not found: generic error "Invalid email or password" (no enumeration)
  │
  ├── bcrypt.compare(password, password_hash)
  │     → If mismatch: same generic error
  │     → Log: audit_logs(action: 'admin_login_failed', metadata: {email, ip})
  │
  ├── On success:
  │     → Create iron-session, write { adminId, roleId, issuedAt }
  │     → Set session cookie: HttpOnly, Secure, SameSite=Lax, Path=/admin
  │     → UPDATE admin_users SET last_login_at, last_login_ip
  │     → Log: audit_logs(action: 'admin_login')
  │
  └── Redirect to /admin/dashboard
```

**Logout:**
```
POST /api/v1/admin/auth/logout
  → Destroy iron-session (clear cookie)
  → Log: audit_logs(action: 'admin_logout')
  → Redirect to /admin/login
```

---

## 3. Dashboard Overview

**Route:** `/admin/dashboard`

**Displays:**
- Today's confirmed bookings (count + list preview).
- Pending booking requests count (badge — updates on page load).
- Payment proofs awaiting verification count.
- Recent activity (last 10 audit log entries for this admin).
- Quick links to: Booking Requests, Courts, Schedule, CMS.

**Data requirements:**
- Server-rendered via React Server Component.
- Data fetched in parallel: today's bookings query + pending count query + pending payment count query.
- No sensitive customer phone numbers displayed on the dashboard summary.

---

## 4. Booking Management Workflows

### 4.1 View Booking Requests

**Route:** `/admin/bookings`

**Default filter:** Status = `payment_submitted` | `under_review` (the action queue)

**Available filters:**
- Status (multi-select)
- Court (dropdown)
- Date range (from / to)
- Search: customer name or phone or booking reference

**Columns in table:**
Reference | Customer Name | Court | Date | Time | Price | Payment Status | Booking Status | Submitted At | Actions

**Pagination:** 25 per page, server-rendered.

**Row actions:**
- [View Details] → opens booking detail page
- Quick [Approve] button (visible only when status = `payment_submitted` or `under_review`)
- Quick [Reject] button

### 4.2 View Booking Detail

**Route:** `/admin/bookings/[id]`

**Sections:**

```
BOOKING INFORMATION
  Reference, Court, Date, Time, Price, Created At

CUSTOMER INFORMATION
  Full Name, Phone Number

PAYMENT INFORMATION
  Method, Amount, Payment Status

PAYMENT PROOF
  Uploaded file viewer (inline image or download link for PDF)
  Upload date, file size, admin who reviewed

BOOKING STATUS HISTORY
  Timeline: created → payment_submitted → [under_review] → approved/rejected
  Each step shows: timestamp, actor (customer / admin name)

ACTIONS
  Available actions depend on current status (see state machine doc)
```

### 4.3 Approve Booking

**Permitted states:** `payment_submitted`, `under_review`
**Required permission:** `approve_booking` + `verify_payment`

```
Admin clicks [Approve Booking]
        │
        ▼
Confirmation dialog shown (booking summary)
        │
        ▼
Admin confirms
        │
        ▼
POST /api/v1/admin/bookings/:id/approve
  → Session check → permission check
  → Load booking, assert status in ['payment_submitted', 'under_review']
  → BEGIN SERIALIZABLE TRANSACTION
      SELECT conflicting approved bookings FOR UPDATE
      If conflict: ROLLBACK → show conflict error with conflicting ref
      UPDATE bookings status → 'approved'
      UPDATE payment_records status → 'verified'
      INSERT audit_log × 2 (booking_approved, payment_verified)
  → COMMIT
  → Return 200 + updated booking
        │
        ▼
Admin sees: "Booking TF-XXXXX approved and confirmed."
Page refreshes booking status.
```

**Conflict error display:**
```
⚠ Cannot approve this booking.

Court 2 on 05 Sep 2026 at 20:00–21:00 is already confirmed
for booking TF-20260905-P9Q3.

You can reject this booking instead.

[Reject Booking]   [Close]
```

### 4.4 Reject Booking

**Permitted states:** `pending`, `payment_submitted`, `under_review`
**Required permission:** `reject_booking`

```
Admin clicks [Reject Booking]
        │
        ▼
Rejection dialog:
  Select reason (dropdown with predefined options)
  Optional: free-text additional notes
        │
        ▼
POST /api/v1/admin/bookings/:id/reject
  { reason: string }
  → Session check → permission check
  → Assert status is rejectable
  → BEGIN TRANSACTION
      UPDATE bookings: status → 'rejected', rejection_reason, rejected_by, rejected_at
      UPDATE payment_records: status → 'rejected' (if was submitted)
      INSERT audit_log
  → COMMIT
  → Slot immediately available for new bookings
```

### 4.5 Cancel Confirmed Booking

**Permitted states:** `approved`
**Required permission:** `cancel_booking`

```
Admin clicks [Cancel Booking]
        │
        ▼
Cancellation dialog:
  "⚠ This will cancel a CONFIRMED booking. Are you sure?"
  Reason (required): [free text]
        │
        ▼
POST /api/v1/admin/bookings/:id/cancel
  { reason: string }
  → Session check → permission check ('cancel_booking')
  → Assert status = 'approved'
  → BEGIN TRANSACTION
      UPDATE bookings: status → 'cancelled', cancellation_reason, cancelled_by, cancelled_at
      INSERT audit_log(booking_cancelled)
  → COMMIT
  → Slot released
```

**Note:** A refund workflow is outside V1 scope. The admin handles refunds manually and can add a note to the booking record.

---

## 5. Court Management Workflows

### 5.1 View Courts List

**Route:** `/admin/courts`

Shows all courts including disabled ones. Toggle to show/hide soft-deleted.

Columns: Name | Type | Status | Display Order | Actions

### 5.2 Add Court

**Route:** `/admin/courts/new`
**Required permission:** `manage_courts`

Form fields:
- Name (required, unique per venue)
- Description (text area)
- Court Type (dropdown: Padel, Padel Covered, etc.)
- Features (multi-select tags: Covered, Lights, Premium Surface, etc.)
- Display Order (integer)
- Status: Active / Inactive
- Photos: upload multiple images (CMS gallery type)

On submit:
```
POST /api/v1/admin/courts
  → Validate name uniqueness per venue
  → INSERT courts
  → INSERT audit_log(court_created)
```

### 5.3 Edit Court

**Route:** `/admin/courts/[id]/edit`

Same form as Add. Pre-populated. Saves via:
```
PATCH /api/v1/admin/courts/:id
  → Validate
  → UPDATE courts (soft, does not affect existing bookings)
  → INSERT audit_log(court_updated)
```

### 5.4 Disable / Enable Court

```
PATCH /api/v1/admin/courts/:id/status
  { is_active: false }
  → Confirmation dialog: "Disabling will prevent new bookings. Existing confirmed bookings are unaffected."
  → UPDATE courts SET is_active = false
  → INSERT audit_log(court_disabled)
```

---

## 6. Pricing Management Workflows

### 6.1 View Pricing Rules

**Route:** `/admin/pricing`

Shows pricing rules per court. Grouped by court.

### 6.2 Create Pricing Rule

Form fields:
- Court (dropdown)
- Label (e.g., "Peak Hours")
- Price (EGP, numeric)
- Applicable Days (checkbox: Sun Mon Tue Wed Thu Fri Sat)
- Time Range: Start – End
- Priority (integer, default 0)
- Active: yes/no

Validation:
- Start time must be before end time.
- Price must be > 0.
- At least one day must be selected.

```
POST /api/v1/admin/pricing
  → INSERT court_pricing_rules
  → INSERT audit_log(pricing_created)
```

### 6.3 Edit / Delete Pricing Rule

- Edit: updates rule going forward.
- Delete: soft-delete (sets `deleted_at`). Does not affect stored prices on existing bookings.

**Important:** The admin is warned that changing prices affects future bookings only. A tooltip explains: "Bookings already created will keep their original price."

---

## 7. Schedule Management Workflows

### 7.1 Operating Hours

**Route:** `/admin/schedule/hours`

7-day grid (Sun–Sat). For each day:
- Toggle: Open / Closed
- If open: Open Time / Close Time

```
PUT /api/v1/admin/schedule/hours
  → Upsert operating_hours rows
  → INSERT audit_log(schedule_updated)
```

### 7.2 Block a Date

**Route:** `/admin/schedule/blocked-dates`

Date picker + reason field.

```
POST /api/v1/admin/schedule/blocked-dates
  { date: "2026-09-08", reason: "National Holiday" }
  → INSERT blocked_dates
  → INSERT audit_log(date_blocked)
```

Blocked dates page shows calendar view with marked dates. Admin can unblock (delete the record).

### 7.3 Block a Time Period

**Route:** `/admin/schedule/blocked-periods`

Form fields:
- Apply to: All Courts / Specific Court (dropdown)
- Start date/time
- End date/time
- Reason

```
POST /api/v1/admin/schedule/blocked-periods
  → INSERT blocked_time_periods
  → INSERT audit_log(period_blocked)
```

### 7.4 Create Maintenance Period

**Route:** `/admin/schedule/maintenance`

Form fields:
- Court (required)
- Start date/time
- End date/time
- Reason (e.g., "Resurfacing", "Equipment repair")

```
POST /api/v1/admin/schedule/maintenance
  → INSERT maintenance_periods
  → INSERT audit_log(maintenance_created)
```

**Warning displayed if existing confirmed bookings fall within the maintenance window:**
```
⚠ Warning: 2 confirmed bookings exist within this maintenance period:
  TF-20260905-K7M2 – 05 Sep 2026, 20:00–21:00
  TF-20260905-P9Q3 – 05 Sep 2026, 21:00–22:00

These bookings will NOT be automatically cancelled. You must manually cancel them.

[Proceed Anyway]   [Cancel]
```

---

## 8. Customer Management Workflow

**Route:** `/admin/customers`
**Required permission:** `manage_customers`

Search by name or phone. Click customer to see:
- Customer details (name, phone, first seen, total bookings)
- All bookings associated with this phone number (table, paginated)
- Admin can add internal notes

---

## 9. Administrator Management Workflow

**Route:** `/admin/administrators`
**Required permission:** `manage_admins` (super_admin only)

### 9.1 Create Admin

Form: Name, Email, Password (temporary), Role

```
POST /api/v1/admin/administrators
  → Hash password (bcrypt cost 12)
  → INSERT admin_users
  → INSERT audit_log(admin_created)
```

### 9.2 Edit Admin

- Change name, email, role.
- Password reset: generates a temporary password; admin must change on next login.

### 9.3 Deactivate Admin

```
PATCH /api/v1/admin/administrators/:id/deactivate
  → Confirmation dialog: "This will prevent [Name] from logging in."
  → UPDATE admin_users SET is_active = false, sessions_invalidated_at = NOW()
  → INSERT audit_log(admin_deactivated)
```

`sessions_invalidated_at` immediately invalidates all active sessions for that admin. On next request, the session middleware checks `sessions_invalidated_at` against the session's `issuedAt`.

---

## 10. Audit Log Viewer

**Route:** `/admin/audit-logs`
**Required permission:** `view_audit_logs`

Table columns: Timestamp | Admin | Action | Entity Type | Entity ID | IP Address | Details

Filters: Admin, Action type, Date range, Entity type

Click any row to expand and see `old_value` / `new_value` JSON diff.

**Important constraints:**
- Audit logs are read-only in the UI. No edit or delete controls exist.
- The database role itself (not just the application) prevents UPDATE/DELETE on `audit_logs`.

---

## 11. Admin UI Design Principles

| Principle | Implementation |
|-----------|---------------|
| No ambiguous states | Every button label describes the outcome, not just the action. "Approve & Confirm Booking" not "Approve". |
| Destructive actions require confirmation | Cancel, reject, deactivate all show a modal with a summary of consequences. |
| Feedback on every action | Toast notifications for success (green) and error (red). Never silent failures. |
| Server error messages are human-readable | "Court 2 is already booked for this time" not "constraint violation 23P01". |
| Permission-invisible UI | Buttons the admin cannot use are hidden, not just disabled. If a section is inaccessible, it is not shown in the nav. |
| Mobile-capable admin | The admin dashboard must work on a tablet and be usable (not beautiful) on a phone. Admins may need to approve bookings from their phone. |

---

## 12. Admin Notification Strategy (V1)

In V1, there are no push or email notifications. Instead:

- The dashboard shows a live pending count badge that refreshes when the admin navigates between pages.
- A prominent "X pending requests" banner appears at the top of every admin page when there are unreviewed bookings.
- Admins are expected to check the dashboard periodically throughout operating hours.

Future versions will add browser push notifications and/or WhatsApp notifications to the admin.
