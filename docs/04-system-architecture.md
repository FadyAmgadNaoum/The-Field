# System Architecture
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. Architecture Decision Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Application pattern | Modular Monolith | Small team, single venue, straightforward ops. Clean module boundaries allow future extraction. |
| Frontend framework | Next.js 14 (App Router) | SSR for SEO, RSC for performance, API routes for backend, TypeScript native. Single repo. |
| Backend | Next.js API Routes + Server Actions | Avoids a separate backend process for V1. Can be extracted to standalone Node.js if needed. |
| Database | PostgreSQL 16 | ACID compliance, exclusion constraints for booking integrity, JSON support for CMS content. |
| ORM | Drizzle ORM | TypeScript-first, thin layer, direct SQL control when needed, migration management built-in. |
| Auth (Admin) | iron-session + bcrypt | Simple, secure, no external auth service dependency. Session stored server-side. |
| File Storage | Hostinger Object Storage or local disk with signed access | Payment proofs need access control; not served as public static files. |
| CSS | Tailwind CSS | Utility-first, mobile-first, no runtime CSS-in-JS overhead. |
| Background Jobs | node-cron within the Next.js process (V1) | Booking expiry job. Simple, no additional infrastructure. |
| Testing | Vitest (unit) + Playwright (E2E) | Vitest is fast and Vite-compatible. Playwright is the industry standard for E2E. |
| Monitoring | Sentry | Error tracking, performance monitoring, easy integration. |
| Process Manager | PM2 | Daemon management, auto-restart, log management on Hostinger VPS. |

---

## 2. High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INTERNET                                     │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ HTTPS
┌─────────────────────────▼───────────────────────────────────────────┐
│                      NGINX (Reverse Proxy)                          │
│              TLS termination · Security headers · Rate limits       │
└──────────┬──────────────────────────────────┬───────────────────────┘
           │                                  │
┌──────────▼──────────────┐      ┌────────────▼──────────────────────┐
│   Next.js Application   │      │        Static Assets CDN          │
│   (PM2 managed)         │      │   (images, JS, CSS bundles)       │
│                         │      └───────────────────────────────────┘
│  ┌─────────────────┐    │
│  │  App Router     │    │
│  │  (React SSR)    │    │
│  │                 │    │
│  │  /              │    │
│  │  /about         │    │
│  │  /courts        │    │
│  │  /book          │    │      ┌───────────────────────────────────┐
│  │  /pricing       │    │      │          PostgreSQL 16             │
│  │  /gallery       │    │◄─────►   (Drizzle ORM / raw SQL where   │
│  │  /faq           │    │      │    needed for locking/exclusion)  │
│  │  /contact       │    │      └───────────────────────────────────┘
│  │  /booking-status│    │
│  │  /admin/**      │    │      ┌───────────────────────────────────┐
│  └─────────────────┘    │      │         File Storage              │
│                         │◄─────►  (Payment proofs + Gallery imgs) │
│  ┌─────────────────┐    │      │  Access-controlled, not public   │
│  │  API Routes     │    │      └───────────────────────────────────┘
│  │  /api/v1/**     │    │
│  │                 │    │      ┌───────────────────────────────────┐
│  │  Server Actions │    │      │             Sentry                │
│  └─────────────────┘    │◄─────►   Error tracking + Performance  │
│                         │      └───────────────────────────────────┘
│  ┌─────────────────┐    │
│  │  Background Job │    │
│  │  (node-cron)    │    │
│  │  Booking expiry │    │
│  └─────────────────┘    │
└─────────────────────────┘
```

---

## 3. Module Architecture

The application is organized into clearly bounded modules. Each module owns its database tables, business logic, and API surface. Modules do not directly query each other's tables — they call each other's service functions.

```
src/
├── modules/
│   ├── venue/          # Venue profile, operating hours, blocked dates
│   ├── courts/         # Court CRUD, court types, court features
│   ├── pricing/        # Pricing rules, price calculation
│   ├── availability/   # Slot calculation, conflict detection
│   ├── bookings/       # Booking lifecycle, state transitions
│   ├── payments/       # Payment records, proof upload, verification
│   ├── customers/      # Customer records (phone-based identity)
│   ├── admin/          # Admin auth, roles, permissions
│   ├── audit/          # Audit log writer
│   ├── cms/            # CMS content types, CRUD
│   ├── storage/        # File upload/download abstraction
│   └── notifications/  # Notification interface (V1: no-op / log only)
│
├── app/                # Next.js App Router pages and layouts
│   ├── (public)/       # Customer-facing route group
│   │   ├── page.tsx            # Home
│   │   ├── about/
│   │   ├── courts/
│   │   ├── book/
│   │   ├── pricing/
│   │   ├── gallery/
│   │   ├── faq/
│   │   ├── contact/
│   │   └── booking-status/
│   └── admin/          # Admin route group (protected)
│       ├── layout.tsx          # Auth guard
│       ├── dashboard/
│       ├── bookings/
│       ├── courts/
│       ├── pricing/
│       ├── schedule/
│       ├── customers/
│       ├── cms/
│       ├── administrators/
│       ├── audit-logs/
│       └── settings/
│
├── api/                # Next.js API route handlers
│   └── v1/
│       ├── availability/
│       ├── bookings/
│       ├── payments/
│       ├── booking-status/
│       └── admin/
│
├── lib/                # Shared utilities
│   ├── db/             # Database connection, transaction helpers
│   ├── auth/           # Session helpers
│   ├── validation/     # Zod schemas
│   ├── errors/         # Typed error classes
│   └── utils/          # Date/time helpers (Egypt timezone)
│
└── jobs/               # Background jobs
    └── expire-bookings.ts
```

### 3.1 Why This Structure

- **Modules by domain, not by technical layer:** Instead of separating all controllers, services, and repositories into flat directories, each domain owns its full stack. This makes each domain independently understandable.
- **No circular dependencies:** Module dependency flows in one direction: `bookings` depends on `availability`, `pricing`, `courts`, `payments`; nothing depends back on `bookings` except `admin` views.
- **Testable in isolation:** Service functions in each module take explicit dependencies (DB client, config) so they can be unit-tested without a running server.

---

## 4. Request Flow — Customer Booking Submission

```
Browser
  │
  ├── POST /api/v1/bookings
  │     │
  │     ├── 1. Rate-limit check (IP-based)
  │     ├── 2. Parse and validate request body (Zod schema)
  │     ├── 3. Sanitize inputs
  │     │
  │     ├── 4. bookings.service.createBooking(input)
  │     │       │
  │     │       ├── 4a. courts.service.assertCourtActive(courtId)
  │     │       ├── 4b. venue.service.assertDateIsOperational(date)
  │     │       ├── 4c. venue.service.assertSlotIsWithinHours(date, startTime, endTime)
  │     │       ├── 4d. pricing.service.calculatePrice(courtId, date, startTime, endTime)
  │     │       │
  │     │       └── 4e. db.transaction()
  │     │               │
  │     │               ├── SELECT ... FOR UPDATE on bookings
  │     │               │   (or exclusion constraint check)
  │     │               ├── If conflict → ROLLBACK → return conflict error
  │     │               ├── INSERT booking (status: pending)
  │     │               ├── INSERT payment record (status: pending)
  │     │               ├── INSERT customer (upsert on phone)
  │     │               └── COMMIT
  │     │
  │     ├── 5. [NON-BLOCKING] If file uploaded: storage.service.saveProof(file, bookingId)
  │     │       → File upload happens AFTER the transaction commits.
  │     │       → On success: update payment status → 'submitted',
  │     │                     booking status → 'payment_submitted' (new short transaction)
  │     │       → On failure: booking remains 'pending'. Customer still receives reference.
  │     │                     Customer can upload proof later via /booking-status page.
  │     │       → The booking reference is ALWAYS returned regardless of upload outcome.
  │     │
  │     ├── 6. Generate booking reference from venues.booking_ref_prefix (e.g. 'TF')
  │     │       → NEVER use a hardcoded prefix constant — always read from venue record.
  │     ├── 7. audit.service.log(action: 'booking_created', ...)
  │     │
  │     └── 8. Return { bookingReference, status, court, date, time, price }
  │
  └── Render confirmation screen
```

---

## 5. Request Flow — Admin Booking Approval

```
Admin Browser
  │
  ├── POST /api/v1/admin/bookings/:id/approve
  │     │
  │     ├── 1. Verify admin session (iron-session)
  │     ├── 2. Check permission: 'approve_booking'
  │     ├── 3. Load booking record — verify it is in approvable state
  │     │
  │     └── 4. bookings.service.approveBooking(bookingId, adminId)
  │               │
  │               └── db.transaction()
  │                       │
  │                       ├── Re-check availability (SELECT FOR UPDATE)
  │                       ├── If conflict found → ROLLBACK → return error to admin
  │                       ├── UPDATE booking SET status = 'approved'
  │                       ├── UPDATE payment SET status = 'verified' (if not already)
  │                       ├── audit.log(action: 'booking_approved', adminId, bookingId)
  │                       └── COMMIT
  │
  └── Admin sees success or conflict error with clear message
```

---

## 6. Concurrency and Booking Integrity

### 6.1 The Race Condition Scenario

Two customers submit booking requests for Court 1, 19:00–20:00 on the same date within milliseconds of each other.

### 6.2 Resolution Strategy

PostgreSQL provides two complementary mechanisms — the design uses both:

**Primary: Advisory Lock + Serializable Transaction**

```sql
-- Within a serializable transaction:
BEGIN ISOLATION LEVEL SERIALIZABLE;

-- Check for conflicts
SELECT id FROM bookings
WHERE court_id = $1
  AND booking_date = $2
  AND status IN ('pending', 'payment_submitted', 'under_review', 'approved')
  AND NOT (end_time <= $3 OR start_time >= $4)
FOR UPDATE;

-- If any row returned → ROLLBACK → return conflict error
-- If no row returned → INSERT booking → COMMIT
```

**Secondary (belt-and-suspenders): PostgreSQL Exclusion Constraint**

```sql
-- On the bookings table (requires btree_gist extension):
-- Uses booking_range, a STORED generated column that combines booking_date + start_time/end_time
-- into a TSTZRANGE (see Database Architecture doc for the full column definition).
-- 'timerange' does NOT exist in PostgreSQL — TSTZRANGE via a generated column is the correct approach.
ALTER TABLE bookings ADD CONSTRAINT no_overlapping_approved_bookings
EXCLUDE USING GIST (
  court_id      WITH =,
  booking_range WITH &&
) WHERE (status = 'approved');
```

The exclusion constraint on `approved` bookings ensures that even if application logic has a bug, the database will reject a duplicate approval.

### 6.3 Pending Booking Availability Display

- Pending bookings are shown as "unavailable" in the UI to prevent multiple customers bidding for the same slot.
- If a pending booking expires (no payment submitted within 2 hours), its slot is released.
- This creates a brief "soft hold" model: the slot is locked from display while a payment is being arranged.
- This is a deliberate business decision: it is better to occasionally block a slot for 2 hours than to allow double payment submissions.

### 6.4 Admin Approval Conflict

If Admin attempts to approve Booking A (Court 1, 19:00–20:00) and Booking B for the same slot is already `approved`:

1. The approval transaction runs.
2. The `SELECT FOR UPDATE` finds the conflicting approved booking.
3. The transaction rolls back.
4. The API returns HTTP 409 Conflict with a clear message: "This time slot was already confirmed for another booking. Booking #REF cannot be approved."
5. The admin is shown this message and can choose to reject the conflicting booking instead.

---

## 7. Layer Responsibilities

| Layer | Responsibility | What It Must Not Do |
|-------|---------------|---------------------|
| **Presentation (React pages)** | Render UI, handle client-side validation, display state | Never enforce business rules, never trust server data as authoritative before API validates |
| **API Route Handlers** | Parse HTTP, validate schema (Zod), call service, return HTTP response | Never contain business logic directly |
| **Service Layer** | Orchestrate business rules, call repositories, manage transactions | Never directly accept HTTP req/res objects |
| **Repository Layer** | Execute database queries, return typed domain objects | Never contain business logic |
| **Database** | Enforce constraints, maintain referential integrity | — |

---

## 8. Technology Stack — Detailed Justification

### 8.1 Next.js (App Router)

- Server-side rendering for public pages improves SEO for "padel Cairo" searches.
- React Server Components reduce JavaScript bundle size for content pages.
- API Routes eliminate the need for a separate Express server in V1.
- File-based routing keeps admin and public routes clearly separated at the filesystem level.
- The App Router's `layout.tsx` is the natural place to add the admin auth guard.

### 8.2 PostgreSQL over MySQL

- `EXCLUDE USING GIST` exclusion constraints are PostgreSQL-specific and critical for booking integrity.
- Better support for range types (`tsrange`, `daterange`) which are natural fits for booking time windows.
- Stronger ACID guarantees and richer constraint language.
- Widely supported on Hostinger VPS.

### 8.3 Drizzle ORM over Prisma

- Drizzle generates raw SQL and has zero runtime overhead.
- Schema is defined in TypeScript; type inference is native.
- Drizzle allows dropping to raw SQL for complex locking queries without fighting the ORM.
- Prisma's migration tooling is heavier and the query engine binary adds deployment complexity on VPS.

### 8.4 iron-session over NextAuth / Lucia

- iron-session encrypts session data in a cookie — simple, stateless from the server's perspective.
- No external service dependency.
- Admin sessions can be invalidated by rotating the session secret (nuclear option) or by storing a `session_revoked_at` timestamp per admin in the DB (per-user revocation).
- NextAuth is powerful but complex for a simple admin-only auth system with custom roles.

### 8.5 node-cron over BullMQ / Agenda

- The booking expiry job is a single, simple task (expire pending bookings older than 2 hours).
- node-cron runs within the Next.js process without requiring a separate Redis instance.
- If future jobs grow complex (email queues, WhatsApp, SMS), BullMQ + Redis can be introduced.

---

## 9. Environment Separation

| Environment | Purpose | Database | File Storage |
|-------------|---------|----------|--------------|
| `development` | Local development | Local PostgreSQL | Local disk (`./uploads/`) |
| `staging` | Pre-production testing | Separate Hostinger DB | Separate storage bucket |
| `production` | Live site | Production Hostinger DB | Production storage bucket |

Environment is controlled by `NODE_ENV` and `.env.local` / `.env.production` files that are never committed to Git.

---

## 10. Inter-Module Dependency Graph

```
admin ──────────────────────────────────────────────────────┐
  │                                                          │
  ▼                                                          ▼
bookings ──► availability ──► courts ◄── pricing           audit
  │               │              │                            ▲
  ▼               ▼              ▼                            │
payments       venue         storage                   (all modules)
  │
  ▼
customers

cms ─── (standalone, no booking dependency)
notifications ─── (depends on bookings for events, no reverse)
```

Rule: No module imports from `bookings` except `admin` and `notifications`. The `bookings` module is the core domain and must not become a god module.

---

## 11. Key Architectural Risks

| Risk | Mitigation |
|------|-----------|
| Next.js API routes create tight frontend/backend coupling | Service layer is framework-agnostic; can be moved to standalone Express with minimal changes |
| node-cron job does not run if server restarts mid-interval | Expiry check also runs at booking approval time (belt-and-suspenders) |
| Single process = single point of failure | PM2 auto-restart; daily DB backups; health check endpoint monitored |
| File storage on local disk risks data loss if VPS is rebuilt | Move to S3-compatible object storage (Hostinger or Cloudflare R2) from day one if budget allows |
