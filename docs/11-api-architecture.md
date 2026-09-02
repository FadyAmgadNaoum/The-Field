# API Architecture
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. API Design Principles

1. **REST over RPC.** Resources are nouns; HTTP verbs carry semantics.
2. **Versioned from day one.** All routes are prefixed `/api/v1/`. A future `/api/v2/` can be introduced without breaking existing clients.
3. **Consistent response envelope.** All responses use a standard JSON envelope.
4. **Typed end-to-end.** Zod schemas validate every request. Response types are shared TypeScript interfaces.
5. **Server-side authority.** The API never trusts prices, statuses, or permissions from the client.
6. **No sensitive data in URLs.** Booking references in paths are acceptable; phone numbers and internal IDs are not.

---

## 2. Standard Response Envelope

### Success

```json
{
  "success": true,
  "data": { ... }
}
```

### Error

```json
{
  "success": false,
  "error": {
    "code": "BOOKING_CONFLICT",
    "message": "This time slot is no longer available.",
    "details": {}
  }
}
```

### Paginated List

```json
{
  "success": true,
  "data": {
    "items": [ ... ],
    "pagination": {
      "page": 1,
      "pageSize": 25,
      "total": 142,
      "totalPages": 6
    }
  }
}
```

---

## 3. Error Codes

| Code | HTTP Status | Description |
|------|------------|-------------|
| `VALIDATION_ERROR` | 400 | Request body or params failed Zod validation |
| `UNAUTHORIZED` | 401 | No valid session |
| `FORBIDDEN` | 403 | Session valid but insufficient permission |
| `NOT_FOUND` | 404 | Resource not found |
| `BOOKING_CONFLICT` | 409 | Time slot not available |
| `STATE_TRANSITION_INVALID` | 422 | Booking/payment status transition not allowed |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error (details logged, not returned) |

---

## 4. Public API Routes

The routes in this section do not require authentication **except where explicitly noted**. Public browsing endpoints (courts, availability) are accessible without a session. The booking creation endpoint requires a customer session.

### 4.1 Availability

```
GET /api/v1/availability?courtId={id}&date={YYYY-MM-DD}
```

**Purpose:** Returns available and unavailable time slots for a court on a date.

**Response:**
```json
{
  "success": true,
  "data": {
    "courtId": "uuid",
    "date": "2026-09-05",
    "slots": [
      { "startTime": "08:00", "endTime": "09:00", "available": true,  "price": 350 },
      { "startTime": "09:00", "endTime": "10:00", "available": false, "price": 350, "reason": "booked" },
      { "startTime": "19:00", "endTime": "20:00", "available": true,  "price": 450 },
      { "startTime": "20:00", "endTime": "21:00", "available": false, "price": 450, "reason": "maintenance" }
    ]
  }
}
```

**Notes:**
- `reason` for unavailable slots: `"booked"` | `"blocked"` | `"maintenance"` | `"outside_hours"` — helps the UI display appropriate messages.
- Slots outside operating hours are not returned.
- Rate limited: 60 req/min per IP.

---

### 4.2 Courts (Public)

```
GET /api/v1/courts
```

Returns all active courts with name, description, features. No pricing included (pricing comes per slot from availability endpoint).

```
GET /api/v1/courts/{id}
```

Single court detail.

---

### 4.3 Bookings — Create

```
POST /api/v1/bookings
Content-Type: multipart/form-data
Authorization: Customer session cookie required (thefield_customer_session)
```

**Requires authentication.** Unauthenticated requests return HTTP 401. The booking flow redirects the customer to `/signin?redirect=/book` with court, date, and time preserved as query parameters.

**Request fields:**
```
courtId:      string (UUID)
date:         string (YYYY-MM-DD)
startTime:    string (HH:MM)
endTime:      string (HH:MM)
customerName: string (2–100 chars)
customerPhone:string (Egyptian mobile: 01[0-2,5]{1}[0-9]{8})
paymentProof: file? (optional at submission; JPEG/PNG/PDF, max 10MB)
```

**Server validation sequence:**
1. Verify customer session — return 401 if absent.
2. Zod schema validation on all fields.
3. Phone number format check (regex).
4. Court exists and is active.
5. Date is operational (not blocked, within operating days).
6. Time slot within operating hours.
7. Price calculated from DB (client-submitted price ignored).
8. Availability check within serializable transaction (full revalidation — pre-auth slot selection is not held).
9. `customer_account_id` sourced from session — never from request body.
10. Insert booking, payment, customer records.
11. If file provided: validate MIME + size, store, update statuses.

**Success response (201):**
```json
{
  "success": true,
  "data": {
    "bookingReference": "TF-20260905-K7M2",
    "courtName": "Court 2",
    "date": "2026-09-05",
    "startTime": "20:00",
    "endTime": "21:00",
    "priceAmount": 400,
    "currency": "EGP",
    "bookingStatus": "payment_submitted",
    "paymentStatus": "submitted"
  }
}
```

**Rate limiting:** 10 booking submissions per IP per hour.

---

### 4.4 Booking Status Lookup

```
POST /api/v1/booking-status
Content-Type: application/json
```

**Requires authentication.** The customer session must own the booking. A booking reference alone never grants access.

**Request:**
```json
{
  "reference": "TF-20260905-K7M2"
}
```

**Rate limiting:** 10 requests per customer account per 10 minutes.

**Response:** See Auth/Authorization doc Section 3.3 for returned fields. Returns friendly status labels only — no internal IDs, no admin notes.

---

### 4.4a Customer Bookings (Authenticated)

```
GET /api/v1/customer/bookings
Authorization: Customer session cookie required
```

Returns all bookings belonging to the authenticated customer. Requires a valid customer session. Returns the same limited response shape as the status lookup, scoped to the session's `customerId`.

---

### 4.5 Payment Proof Upload (Late)

```
POST /api/v1/bookings/proof
Content-Type: multipart/form-data
```

**Request:**
```
reference:    string
phone:        string
paymentProof: file (required)
```

**Rate limiting:** 5 uploads per IP per hour.

---

### 4.6 CMS Content (Public Read)

```
GET /api/v1/cms/settings?group={groupName}
GET /api/v1/cms/faqs
GET /api/v1/cms/events?published=true
GET /api/v1/cms/announcements?active=true
GET /api/v1/cms/gallery?published=true
GET /api/v1/cms/social-links
```

These endpoints serve content to the Next.js server-side pages. They are NOT used for client-side fetching (SSR fetches directly from the DB). They may be useful for future headless use cases.

**Note:** These return only published, non-deleted content. Admin-only fields (created_by, deleted_at, etc.) are stripped.

---

## 5. Admin API Routes (Authentication Required)

All admin routes:
- Require a valid `thefield_admin_session` cookie.
- Are scoped to the venue configured in the server environment.
- Log to audit_logs on state-changing operations.

### 5.1 Admin Auth

```
POST   /api/v1/admin/auth/login
POST   /api/v1/admin/auth/logout
GET    /api/v1/admin/auth/me        → returns current admin profile
```

---

### 5.2 Bookings

```
GET    /api/v1/admin/bookings
         ?status=payment_submitted,under_review
         &courtId={id}
         &dateFrom=YYYY-MM-DD
         &dateTo=YYYY-MM-DD
         &search={name|phone|ref}
         &page=1
         &pageSize=25

GET    /api/v1/admin/bookings/{id}

POST   /api/v1/admin/bookings/{id}/approve
POST   /api/v1/admin/bookings/{id}/reject     Body: { reason: string }
POST   /api/v1/admin/bookings/{id}/cancel     Body: { reason: string }
POST   /api/v1/admin/bookings/{id}/review     (marks as under_review)
```

---

### 5.3 Payment Proofs

```
GET    /api/v1/admin/bookings/{bookingId}/proofs
GET    /api/v1/admin/bookings/{bookingId}/proofs/{proofId}/view
         → Redirects to a signed, time-limited URL for the proof file
```

---

### 5.4 Courts

```
GET    /api/v1/admin/courts
POST   /api/v1/admin/courts
         Body: { name, description, courtType, features[], displayOrder, isActive }

GET    /api/v1/admin/courts/{id}
PATCH  /api/v1/admin/courts/{id}
PATCH  /api/v1/admin/courts/{id}/status   Body: { isActive: boolean }
DELETE /api/v1/admin/courts/{id}          (soft delete — sets deleted_at)
```

---

### 5.5 Pricing

```
GET    /api/v1/admin/pricing?courtId={id}
POST   /api/v1/admin/pricing
         Body: { courtId, label, priceAmount, applicableDays[], startTime, endTime, priority }

PATCH  /api/v1/admin/pricing/{id}
DELETE /api/v1/admin/pricing/{id}   (soft delete)
```

---

### 5.6 Schedule

```
GET    /api/v1/admin/schedule/hours
PUT    /api/v1/admin/schedule/hours
         Body: { hours: [{ dayOfWeek, openTime, closeTime, isActive }] }

GET    /api/v1/admin/schedule/blocked-dates
POST   /api/v1/admin/schedule/blocked-dates  Body: { date, reason? }
DELETE /api/v1/admin/schedule/blocked-dates/{id}

GET    /api/v1/admin/schedule/blocked-periods
POST   /api/v1/admin/schedule/blocked-periods
         Body: { courtId?, startDatetime, endDatetime, reason? }
DELETE /api/v1/admin/schedule/blocked-periods/{id}

GET    /api/v1/admin/schedule/maintenance
POST   /api/v1/admin/schedule/maintenance
         Body: { courtId, startDatetime, endDatetime, reason? }
DELETE /api/v1/admin/schedule/maintenance/{id}
```

---

### 5.7 Customers

```
GET    /api/v1/admin/customers?search={name|phone}&page=1
GET    /api/v1/admin/customers/{id}
PATCH  /api/v1/admin/customers/{id}   Body: { notes? }
```

---

### 5.8 CMS (Admin Write)

```
GET    /api/v1/admin/cms/settings?group={group}
PUT    /api/v1/admin/cms/settings
         Body: { settings: { key: value, ... } }

GET    /api/v1/admin/cms/faqs
POST   /api/v1/admin/cms/faqs
PATCH  /api/v1/admin/cms/faqs/{id}
DELETE /api/v1/admin/cms/faqs/{id}
PUT    /api/v1/admin/cms/faqs/reorder  Body: { orderedIds: string[] }

GET    /api/v1/admin/cms/gallery
POST   /api/v1/admin/cms/gallery        (multipart: image file + metadata)
PATCH  /api/v1/admin/cms/gallery/{id}
DELETE /api/v1/admin/cms/gallery/{id}

GET    /api/v1/admin/cms/events
POST   /api/v1/admin/cms/events
PATCH  /api/v1/admin/cms/events/{id}
DELETE /api/v1/admin/cms/events/{id}

GET    /api/v1/admin/cms/announcements
POST   /api/v1/admin/cms/announcements
PATCH  /api/v1/admin/cms/announcements/{id}
DELETE /api/v1/admin/cms/announcements/{id}

GET    /api/v1/admin/cms/social-links
PUT    /api/v1/admin/cms/social-links   Body: { links: [{ platform, url, isActive }] }
```

---

### 5.9 Administrators

```
GET    /api/v1/admin/administrators          (super_admin only)
POST   /api/v1/admin/administrators          Body: { email, fullName, password, roleId }
GET    /api/v1/admin/administrators/{id}
PATCH  /api/v1/admin/administrators/{id}
POST   /api/v1/admin/administrators/{id}/deactivate
POST   /api/v1/admin/administrators/{id}/activate
```

---

### 5.10 Roles

```
GET    /api/v1/admin/roles                   (super_admin only)
GET    /api/v1/admin/roles/{id}/permissions
```

Roles are predefined and cannot be created or deleted via the API in V1. Permissions can be adjusted per role by a super_admin.

---

### 5.11 Audit Logs

```
GET    /api/v1/admin/audit-logs
         ?adminId={id}
         &action={action}
         &entityType={type}
         &dateFrom=YYYY-MM-DD
         &dateTo=YYYY-MM-DD
         &page=1
         &pageSize=50
```

Read-only. No POST, PATCH, or DELETE.

---

### 5.12 Dashboard

```
GET    /api/v1/admin/dashboard/summary
```

Returns:
```json
{
  "todayConfirmedCount": 8,
  "pendingRequestsCount": 3,
  "awaitingPaymentVerificationCount": 2,
  "upcomingBookings": [ ... 5 items ... ]
}
```

---

### 5.13 Health Check

```
GET    /api/health
```

No authentication. Returns HTTP 200 with:
```json
{
  "status": "ok",
  "timestamp": "2026-09-05T18:00:00Z",
  "database": "connected",
  "version": "1.0.0"
}
```

Used by uptime monitoring services (UptimeRobot, Hostinger monitoring, etc.).

---

## 6. Request Validation Pattern

Every API route that accepts a body uses a Zod schema defined alongside the route:

```typescript
// src/app/api/v1/bookings/route.ts

import { z } from 'zod'
import { egyptianPhoneRegex } from '@/lib/validation/phone'

const CreateBookingSchema = z.object({
  courtId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):00$/),  // hour-aligned slots only
  endTime: z.string().regex(/^([01]\d|2[0-3]):00$/),
  customerName: z.string().min(2).max(100).trim(),
  customerPhone: z.string().regex(egyptianPhoneRegex),
})

export async function POST(req: Request) {
  const body = await req.json()
  const parsed = CreateBookingSchema.safeParse(body)

  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 400, parsed.error.flatten())
  }

  // parsed.data is fully typed
  const result = await bookingService.createBooking(parsed.data)
  ...
}
```

**Zod schemas are the single source of truth for request shape.** The same schema is exported and used by the frontend `fetch` call's type annotations.

---

## 7. Rate Limiting Summary

| Endpoint | Limit | Window | Key |
|----------|-------|--------|-----|
| `POST /api/v1/bookings` | 10 requests | 1 hour | IP |
| `POST /api/v1/booking-status` | 10 requests | 10 minutes | IP |
| `POST /api/v1/bookings/proof` | 5 requests | 1 hour | IP |
| `GET /api/v1/availability` | 60 requests | 1 minute | IP |
| `POST /api/v1/admin/auth/login` | 5 requests | 15 minutes | IP |
| All other admin routes | 120 requests | 1 minute | Admin ID |

Rate limiting is implemented using `rate-limiter-flexible` with an in-memory store (sufficient for single-process V1). The NGINX layer provides a coarser global rate limit as a first defense.

---

## 8. API Versioning Strategy

- V1: `/api/v1/` — current.
- V2 introduction: add new routes at `/api/v2/` without removing V1 routes. Deprecate V1 with a sunset notice header.
- Breaking changes always require a new version prefix.
- Non-breaking additions (new fields in responses) can be made within the same version.
