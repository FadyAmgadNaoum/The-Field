# Implementation Blueprint
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** FINAL — Ready for Coding Agent Handoff  
**Source of Truth:** Documents 01–21 in this repository

---

## Preamble

This is the single document a coding agent needs to implement Version 1 of The Field. It synthesises all 21 specification documents and the Architecture Review Report into an ordered, task-level blueprint.

### Hard Constraints That Must Never Be Violated

1. **V1 is exclusively for The Field.** One venue. No multi-venue UI, no marketplace, no venue discovery, no venue owner accounts. The internal schema has a `venues` table for future extensibility, but the customer and admin experience is 100% focused on The Field.
2. **Never trust the browser** for: prices, booking status, payment status, role/permissions, court availability, or user identity.
3. **The database enforces booking integrity.** The PostgreSQL exclusion constraint on `booking_range` is not optional. Application-level checks are supplementary.
4. **Open business decisions remain pending.** OBD-001 through OBD-005 have no confirmed values. Where the system needs a value, use a configurable mechanism — environment variable, database setting, or CMS key — and leave the actual value unset (or set to a clearly marked placeholder). Do not invent business values.
5. **Language for V1 is bilingual Arabic + English (OBD-003 resolved).** Implement translated customer-facing UI and full RTL support for Arabic from the start. Use semantic HTML, logical CSS properties, and no hard-coded LTR-specific layout assumptions.
6. **Operating hours are unconfirmed (OBD-004).** The `operating_hours` table and the admin UI to manage it must exist from day one. Do not seed fake hours. The application must handle the case where no hours are configured yet (show a clear admin message; block public bookings gracefully).

---

## Section 1: Final Architecture

### 1.1 Pattern

**Modular Monolith.** A single Next.js 14 application on a single Hostinger VPS. All business logic is in TypeScript modules with explicit domain boundaries. No microservices. No distributed queues. No Kubernetes.

### 1.2 Boundary Map

```
┌─────────────────────────────────────────────────────────────────┐
│  INTERNET                                                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS only
┌──────────────────────────▼──────────────────────────────────────┐
│  NGINX 1.24+                                                     │
│  • TLS termination (Let's Encrypt / Certbot)                    │
│  • HTTP → HTTPS redirect + HSTS                                 │
│  • Rate limiting (booking, admin-login, general zones)          │
│  • Security headers (belt-and-suspenders)                       │
│  • Reverse proxy → 127.0.0.1:3000                               │
│  • client_max_body_size 12m                                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  PM2 (fork mode, 1 instance)                                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Next.js 14 App (Node.js 20 LTS, port 3000)              │ │
│  │                                                            │ │
│  │  App Router                                                │ │
│  │  ├── (public)/*        Customer-facing pages (SSR/RSC)    │ │
│  │  ├── admin/*           Admin dashboard (protected)        │ │
│  │  ├── api/v1/*          REST API routes                    │ │
│  │  └── api/health        Health check (public)              │ │
│  │                                                            │ │
│  │  Domain Modules (src/modules/)                            │ │
│  │  venue · courts · pricing · availability · bookings       │ │
│  │  payments · customers · admin · audit · cms · storage     │ │
│  │  notifications (no-op V1)                                 │ │
│  │                                                            │ │
│  │  Background Jobs (src/jobs/)                              │ │
│  │  node-cron: expire-bookings (interval: configurable)      │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────┬──────────────────────────────┬───────────────────────┘
           │                              │
┌──────────▼──────────┐      ┌────────────▼──────────────────────┐
│  PostgreSQL 16       │      │  Cloudflare R2                    │
│  127.0.0.1:5432      │      │  • thefield-private (proofs)      │
│  (not public)        │      │  • thefield-public (media)        │
│  Daily pg_dump → R2  │      │  • thefield-backups (DB backups)  │
└─────────────────────┘      └───────────────────────────────────┘
           │
┌──────────▼──────────┐
│  Sentry + UptimeRobot│
│  (external services) │
└─────────────────────┘
```

### 1.3 Module Dependency Rules

```
admin      → bookings, courts, pricing, payments, customers, cms, audit
bookings   → availability, pricing, courts, payments, customers, audit, storage
payments   → storage, audit
cms        → storage, audit
availability → courts, venue
pricing    → courts
storage    → (no domain deps — pure infrastructure)
audit      → (no domain deps — write-only, append-only)
notifications → (interface only in V1; no-op implementation)
```

**Rules enforced:**
- No module may import from `bookings` except `admin` and `notifications`.
- No module may directly query another module's DB tables — only its service functions.
- `storage` and `audit` are infrastructure modules; any domain module may call them.

---

## Section 2: Final Technology Stack

| Layer | Package | Version Constraint | Notes |
|-------|---------|-------------------|-------|
| Runtime | Node.js | 20 LTS | NodeSource install on Ubuntu 22.04 |
| Framework | Next.js | ^14.2.0 | App Router, RSC, API Routes |
| Language | TypeScript | ^5.4.0 | strict mode, no `any` |
| Styling | Tailwind CSS | ^3.4.0 | mobile-first; full Arabic RTL support using `rtl:` variants |
| Database | PostgreSQL | 16 | self-managed on VPS |
| ORM | drizzle-orm | ^0.30.0 | Drizzle Kit for migrations |
| DB driver | postgres (pg) | ^3.4.0 | native pg driver used by drizzle-orm |
| Auth sessions | iron-session | ^8.0.1 | encrypted cookies for separate admin and customer sessions |
| Password hash | bcryptjs | ^2.4.3 | cost factor 12 |
| Input validation | zod | ^3.22.0 | API and form schema |
| File type detection | file-type | ^19.0.0 | magic-byte MIME validation |
| Image optimisation | sharp | ^0.33.0 | CMS image resize/WebP |
| HTML sanitiser | sanitize-html | ^2.13.0 | CMS rich text fields |
| Structured logging | pino | ^9.0.0 | JSON in prod, pino-pretty in dev |
| Error monitoring | @sentry/nextjs | ^8.0.0 | DSN from env var |
| Background jobs | node-cron | ^3.0.0 | booking expiry job |
| Rate limiting | rate-limiter-flexible | ^5.0.0 | in-memory, application layer |
| Storage SDK | @aws-sdk/client-s3 | ^3.600.0 | Cloudflare R2 compatible |
| Storage presigner | @aws-sdk/s3-request-presigner | ^3.600.0 | signed URLs for proofs |
| ULID | ulid | ^2.3.0 | storage keys, booking ref suffix |
| Unit tests | vitest | ^1.6.0 | |
| Test DB utils | @testcontainers/postgresql | ^10.0.0 | real PG in integration tests |
| E2E tests | @playwright/test | ^1.44.0 | |
| HTTP test helper | supertest | ^7.0.0 | API route integration tests |
| Coverage | @vitest/coverage-v8 | ^1.6.0 | |
| Linting | eslint + @typescript-eslint | ^8.0.0 | |
| Formatting | prettier | ^3.3.0 | |
| Secret scanning | gitleaks | latest | pre-commit + CI |
| Process manager | pm2 | ^5.4.0 | global install on VPS |

**Not in V1 (reserved for future):**
- BullMQ / Redis (job queues)
- next-intl / i18next (internationalisation — pending OBD-003)
- Paymob / Fawry / Stripe (payment gateways)
- WhatsApp Business API
- NextAuth / Lucia (customer authentication uses the documented Google OAuth/email-password flow and iron-session)

---

## Section 3: Final Directory Structure

```
d:\The Field\                          ← workspace root (this repo)
├── docs/                              ← all spec documents (existing)
├── src/
│   ├── app/                           ← Next.js App Router
│   │   ├── (public)/                  ← customer-facing route group
│   │   │   ├── layout.tsx             ← public layout (nav, footer)
│   │   │   ├── page.tsx               ← Home
│   │   │   ├── about/page.tsx
│   │   │   ├── courts/page.tsx
│   │   │   ├── book/
│   │   │   │   ├── page.tsx           ← booking flow entry
│   │   │   │   └── [step]/page.tsx    ← step-based flow (optional)
│   │   │   ├── pricing/page.tsx
│   │   │   ├── gallery/page.tsx
│   │   │   ├── faq/page.tsx
│   │   │   ├── contact/page.tsx
│   │   │   └── booking-status/page.tsx
│   │   ├── admin/                     ← admin route group (all protected)
│   │   │   ├── layout.tsx             ← admin layout + auth guard
│   │   │   ├── login/page.tsx
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── bookings/
│   │   │   │   ├── page.tsx           ← booking list
│   │   │   │   └── [id]/page.tsx      ← booking detail
│   │   │   ├── courts/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [id]/edit/page.tsx
│   │   │   ├── pricing/page.tsx
│   │   │   ├── schedule/
│   │   │   │   ├── hours/page.tsx
│   │   │   │   ├── blocked-dates/page.tsx
│   │   │   │   ├── blocked-periods/page.tsx
│   │   │   │   └── maintenance/page.tsx
│   │   │   ├── customers/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── cms/
│   │   │   │   ├── settings/page.tsx
│   │   │   │   ├── faqs/page.tsx
│   │   │   │   ├── gallery/page.tsx
│   │   │   │   ├── events/page.tsx
│   │   │   │   ├── announcements/page.tsx
│   │   │   │   └── social/page.tsx
│   │   │   ├── administrators/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── audit-logs/page.tsx
│   │   │   └── settings/page.tsx
│   │   ├── api/
│   │   │   ├── health/route.ts        ← public health check
│   │   │   └── v1/
│   │   │       ├── courts/
│   │   │       │   ├── route.ts       ← GET /api/v1/courts
│   │   │       │   └── [id]/route.ts
│   │   │       ├── availability/route.ts
│   │   │       ├── bookings/
│   │   │       │   ├── route.ts       ← POST /api/v1/bookings
│   │   │       │   └── proof/route.ts ← POST /api/v1/bookings/proof
│   │   │       ├── booking-status/route.ts
│   │   │       └── admin/
│   │   │           ├── auth/
│   │   │           │   ├── login/route.ts
│   │   │           │   ├── logout/route.ts
│   │   │           │   └── me/route.ts
│   │   │           ├── dashboard/summary/route.ts
│   │   │           ├── bookings/
│   │   │           │   ├── route.ts
│   │   │           │   └── [id]/
│   │   │           │       ├── route.ts
│   │   │           │       ├── approve/route.ts
│   │   │           │       ├── reject/route.ts
│   │   │           │       ├── cancel/route.ts
│   │   │           │       ├── review/route.ts
│   │   │           │       └── proofs/
│   │   │           │           ├── route.ts
│   │   │           │           └── [proofId]/view/route.ts
│   │   │           ├── courts/
│   │   │           │   ├── route.ts
│   │   │           │   └── [id]/
│   │   │           │       ├── route.ts
│   │   │           │       └── status/route.ts
│   │   │           ├── pricing/
│   │   │           │   ├── route.ts
│   │   │           │   └── [id]/route.ts
│   │   │           ├── schedule/
│   │   │           │   ├── hours/route.ts
│   │   │           │   ├── blocked-dates/
│   │   │           │   │   ├── route.ts
│   │   │           │   │   └── [id]/route.ts
│   │   │           │   ├── blocked-periods/
│   │   │           │   │   ├── route.ts
│   │   │           │   │   └── [id]/route.ts
│   │   │           │   └── maintenance/
│   │   │           │       ├── route.ts
│   │   │           │       └── [id]/route.ts
│   │   │           ├── customers/
│   │   │           │   ├── route.ts
│   │   │           │   └── [id]/route.ts
│   │   │           ├── cms/
│   │   │           │   ├── settings/route.ts
│   │   │           │   ├── faqs/
│   │   │           │   │   ├── route.ts
│   │   │           │   │   ├── [id]/route.ts
│   │   │           │   │   └── reorder/route.ts
│   │   │           │   ├── gallery/
│   │   │           │   │   ├── route.ts
│   │   │           │   │   └── [id]/route.ts
│   │   │           │   ├── events/
│   │   │           │   │   ├── route.ts
│   │   │           │   │   └── [id]/route.ts
│   │   │           │   ├── announcements/
│   │   │           │   │   ├── route.ts
│   │   │           │   │   └── [id]/route.ts
│   │   │           │   └── social-links/route.ts
│   │   │           ├── administrators/
│   │   │           │   ├── route.ts
│   │   │           │   └── [id]/
│   │   │           │       ├── route.ts
│   │   │           │       ├── deactivate/route.ts
│   │   │           │       └── activate/route.ts
│   │   │           ├── roles/
│   │   │           │   ├── route.ts
│   │   │           │   └── [id]/permissions/route.ts
│   │   │           └── audit-logs/route.ts
│   │   ├── globals.css
│   │   ├── layout.tsx                 ← root layout
│   │   └── middleware.ts              ← security headers, admin route guard
│   │
│   ├── modules/                       ← domain modules
│   │   ├── venue/
│   │   │   ├── venue.service.ts
│   │   │   ├── venue.repository.ts
│   │   │   └── venue.types.ts
│   │   ├── courts/
│   │   │   ├── courts.service.ts
│   │   │   ├── courts.repository.ts
│   │   │   └── courts.types.ts
│   │   ├── pricing/
│   │   │   ├── pricing.service.ts
│   │   │   ├── pricing.repository.ts
│   │   │   ├── pricing.calculator.ts  ← pure function, unit-testable
│   │   │   └── pricing.types.ts
│   │   ├── availability/
│   │   │   ├── availability.service.ts
│   │   │   ├── availability.repository.ts
│   │   │   ├── slot.generator.ts      ← pure function, unit-testable
│   │   │   ├── conflict.detector.ts   ← pure function, unit-testable
│   │   │   └── availability.types.ts
│   │   ├── bookings/
│   │   │   ├── bookings.service.ts
│   │   │   ├── bookings.repository.ts
│   │   │   ├── booking.state-machine.ts ← pure, unit-testable
│   │   │   ├── booking.reference.ts     ← reference generator
│   │   │   └── bookings.types.ts
│   │   ├── payments/
│   │   │   ├── payments.service.ts
│   │   │   ├── payments.repository.ts
│   │   │   └── payments.types.ts
│   │   ├── customers/
│   │   │   ├── customers.service.ts
│   │   │   ├── customers.repository.ts
│   │   │   └── customers.types.ts
│   │   ├── admin/
│   │   │   ├── admin.service.ts
│   │   │   ├── admin.repository.ts
│   │   │   └── admin.types.ts
│   │   ├── audit/
│   │   │   ├── audit.service.ts       ← append-only writer
│   │   │   ├── audit.repository.ts
│   │   │   └── audit.types.ts
│   │   ├── cms/
│   │   │   ├── cms.service.ts
│   │   │   ├── cms.repository.ts
│   │   │   ├── cms.validators.ts
│   │   │   ├── cms.types.ts
│   │   │   └── cms.defaults.ts        ← seed defaults (no invented business values)
│   │   ├── storage/
│   │   │   ├── storage.service.ts     ← StorageService interface
│   │   │   ├── storage.s3.ts          ← S3/R2 implementation
│   │   │   ├── storage.local.ts       ← local disk (dev/fallback)
│   │   │   └── storage.types.ts
│   │   └── notifications/
│   │       ├── notifications.service.ts ← interface + no-op impl
│   │       └── notifications.types.ts
│   │
│   ├── lib/
│   │   ├── db/
│   │   │   ├── client.ts              ← drizzle db instance
│   │   │   ├── schema.ts              ← re-exports all table definitions
│   │   │   └── transaction.ts         ← transaction helper with typed context
│   │   ├── auth/
│   │   │   ├── session.ts             ← iron-session config + getAdminSession
│   │   │   └── permissions.ts         ← requirePermission helper
│   │   ├── validation/
│   │   │   ├── phone.ts               ← Egyptian phone regex
│   │   │   ├── date.ts                ← date format + range validators
│   │   │   └── file.ts                ← upload validation helpers
│   │   ├── errors/
│   │   │   ├── index.ts               ← typed error classes
│   │   │   └── api.ts                 ← apiSuccess / apiError response helpers
│   │   ├── config.ts                  ← venue config from env vars (VENUE_ID, etc.)
│   │   └── logger.ts                  ← pino instance with redaction
│   │
│   ├── db/
│   │   ├── schema/                    ← one file per table
│   │   │   ├── venues.ts
│   │   │   ├── courts.ts
│   │   │   ├── pricing-rules.ts
│   │   │   ├── operating-hours.ts
│   │   │   ├── blocked-dates.ts
│   │   │   ├── blocked-time-periods.ts
│   │   │   ├── maintenance-periods.ts
│   │   │   ├── customers.ts
│   │   │   ├── bookings.ts
│   │   │   ├── payment-records.ts
│   │   │   ├── payment-proofs.ts
│   │   │   ├── admin-roles.ts
│   │   │   ├── admin-role-permissions.ts
│   │   │   ├── admin-users.ts
│   │   │   ├── audit-logs.ts
│   │   │   ├── cms-site-settings.ts
│   │   │   ├── cms-faqs.ts
│   │   │   ├── cms-gallery-items.ts
│   │   │   ├── cms-events.ts
│   │   │   ├── cms-announcements.ts
│   │   │   └── cms-social-links.ts
│   │   ├── migrations/                ← drizzle-kit generated migrations
│   │   └── seed.ts                    ← seed: venue row, roles, super-admin
│   │
│   ├── jobs/
│   │   └── expire-bookings.ts         ← node-cron job
│   │
│   └── components/                    ← React UI components
│       ├── ui/                        ← primitive components (Button, Input, etc.)
│       ├── booking/                   ← booking flow components
│       ├── admin/                     ← admin dashboard components
│       └── cms/                       ← CMS editor components
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
│
├── public/                            ← static assets
├── nginx/
│   └── thefield.conf                  ← NGINX config template
├── scripts/
│   ├── deploy.sh
│   ├── backup-db.sh
│   └── health-check.sh
├── .env.example                       ← all env vars documented, no real values
├── .gitignore                         ← includes .env*, /storage, node_modules
├── drizzle.config.ts
├── ecosystem.config.js                ← PM2 config
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json                      ← strict: true
├── vitest.config.ts
├── playwright.config.ts
└── package.json
```

---

## Section 4: Final Database Implementation Plan

### 4.1 Prerequisites (Milestone 0, Task 1 — BLOCKING)

```sql
-- Run immediately on target PostgreSQL instance before any migration:
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";   -- REQUIRED for exclusion constraint
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

If `btree_gist` is not available on the Hostinger managed database plan, the deployment must switch to a self-managed PostgreSQL VPS installation where `postgresql-16-contrib` is available. Do not proceed with schema work until this is verified.

### 4.2 Schema Implementation Order

Implement tables in this exact dependency order:

```
1. venues
2. admin_roles
3. admin_role_permissions
4. admin_users
5. courts
6. court_pricing_rules
7. operating_hours
8. blocked_dates
9. blocked_time_periods
10. maintenance_periods
11. customers
12. bookings  ←── critical: exclusion constraint added here
13. payment_records
14. payment_proofs
15. audit_logs
16. cms_site_settings
17. cms_faqs
18. cms_gallery_items
19. cms_events
20. cms_announcements
21. cms_social_links
```

### 4.3 Critical Booking Table Details

The `bookings` table requires extra care. Key points for the coding agent:

**The `booking_range` generated column:**
```sql
booking_range TSTZRANGE GENERATED ALWAYS AS (
    tstzrange(
        (booking_date + start_time) AT TIME ZONE 'Africa/Cairo',
        (booking_date + end_time)   AT TIME ZONE 'Africa/Cairo'
    )
) STORED
```
This is a PostgreSQL computed column. Drizzle ORM does not natively support generated columns in its schema DSL at the time of writing. Use a raw SQL migration for this column and the exclusion constraint. The Drizzle schema file for `bookings` should define all other columns normally and include a comment directing the developer to the raw SQL migration for the generated column.

**Drizzle schema file approach:**
```typescript
// src/db/schema/bookings.ts
// NOTE: booking_range (TSTZRANGE GENERATED ALWAYS AS) and the
// no_overlapping_approved_bookings exclusion constraint are defined
// in the raw SQL migration: /src/db/migrations/0001_booking_integrity.sql
// Do NOT attempt to define them via Drizzle's schema DSL.
export const bookings = pgTable('bookings', {
  // ... all other columns
});
```

**Raw migration file:**
```sql
-- src/db/migrations/0001_booking_integrity.sql
-- Run AFTER the bookings table is created by Drizzle.

ALTER TABLE bookings
  ADD COLUMN booking_range TSTZRANGE GENERATED ALWAYS AS (
    tstzrange(
      (booking_date + start_time) AT TIME ZONE 'Africa/Cairo',
      (booking_date + end_time)   AT TIME ZONE 'Africa/Cairo'
    )
  ) STORED;

ALTER TABLE bookings
  ADD CONSTRAINT no_overlapping_approved_bookings
  EXCLUDE USING GIST (
    court_id      WITH =,
    booking_range WITH &&
  ) WHERE (status = 'approved');
```

**The migration runner must execute both Drizzle-managed migrations and the raw SQL migration files in order.** Add a migration runner step that applies `*.sql` files from a `migrations/raw/` directory after the Drizzle push.

### 4.4 PostgreSQL Role Setup

```sql
-- app_user: application runtime
CREATE ROLE app_user LOGIN PASSWORD '${APP_DB_PASSWORD}';
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Revoke destructive operations on protected tables
REVOKE DELETE ON bookings FROM app_user;
REVOKE DELETE ON payment_records FROM app_user;
REVOKE DELETE ON payment_proofs FROM app_user;
REVOKE UPDATE, DELETE ON audit_logs FROM app_user;

-- backup_user: used by backup script only
CREATE ROLE backup_user LOGIN PASSWORD '${BACKUP_DB_PASSWORD}';
GRANT CONNECT ON DATABASE thefield TO backup_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_user;

-- migration_user: used only during deployments
CREATE ROLE migration_user LOGIN PASSWORD '${MIGRATION_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON DATABASE thefield TO migration_user;
```

Store three separate connection strings in environment variables:
- `DATABASE_URL` → app_user
- `DATABASE_BACKUP_URL` → backup_user
- `DATABASE_MIGRATION_URL` → migration_user

### 4.5 Seed Script Contract

The seed script (`src/db/seed.ts`) must create:

1. One `venues` row for The Field:
   - `slug`: `'the-field'`
   - `name`: `'The Field'` (can be overridden via CMS after launch)
   - `timezone`: `'Africa/Cairo'`
   - `currency`: `'EGP'`
   - `booking_ref_prefix`: `'TF'`
   - `is_active`: `true`

2. Three `admin_roles` rows: `super_admin`, `admin`, `viewer`

3. All permission rows for each role (from the permission matrix in Doc 05)

4. One `admin_users` row:
   - Email from `SEED_ADMIN_EMAIL` env var (must be provided at deploy time)
   - Password from `SEED_ADMIN_PASSWORD` env var (must be changed on first login)
   - `must_change_password`: `true`
   - Role: `super_admin`

5. **No operating hours.** The `operating_hours` table starts empty. The admin must configure hours via the dashboard. The public booking page must gracefully handle absent hours (show "Operating hours not yet configured" rather than crashing).

6. **No courts.** Courts are created by the admin via the dashboard.

7. **No pricing rules.** Created by the admin after courts exist.

8. **No CMS content.** The CMS starts empty. The public pages must gracefully handle absent CMS content (show fallback text, not crash).

### 4.6 Open Business Decision Handling in Database

| OBD | Database Impact | Implementation |
|-----|----------------|----------------|
| OBD-002 (expiry timeout) | `bookings.expires_at` is set at booking creation | Read from `BOOKING_EXPIRY_MINUTES` env var. If not set, application must refuse to create bookings and log a startup warning. Do NOT default to 120 — leave it unset. |
| OBD-004 (operating schedule) | `operating_hours` table | Starts empty. Application handles gracefully. Admin configures via dashboard. |

---

## Section 5: Final API Implementation Plan

### 5.1 Response Envelope Standard

Every API route must use these helpers from `src/lib/errors/api.ts`:

```typescript
// Success
return apiSuccess(data, 200 | 201)
// → { success: true, data }

// Error
return apiError(code, httpStatus, message, details?)
// → { success: false, error: { code, message, details } }

// Paginated
return apiSuccess({ items, pagination: { page, pageSize, total, totalPages } })
```

### 5.2 Route Handler Pattern

Every API route handler must follow this pattern — no exceptions:

```typescript
export async function POST(req: Request) {
  // 1. Rate limit check (if applicable)
  // 2. Parse body
  // 3. Zod schema validation → return 400 on failure
  // 4. Auth check (if protected) → return 401 on failure
  // 5. Permission check (if admin) → return 403 on failure
  // 6. Call service function
  // 7. Return response
  // Never expose internal errors to the client
}
```

### 5.3 Public Routes — Implementation Requirements

| Route | Method | Handler File | Key Requirements |
|-------|--------|-------------|-----------------|
| `/api/v1/courts` | GET | `api/v1/courts/route.ts` | Returns active courts only. Scoped to VENUE_ID env var. Rate limited: NGINX general zone. |
| `/api/v1/courts/[id]` | GET | `api/v1/courts/[id]/route.ts` | Returns single active court. 404 if not found or inactive. |
| `/api/v1/availability` | GET | `api/v1/availability/route.ts` | Query params: `courtId` (UUID), `date` (YYYY-MM-DD). Rate limited: 60/min. Returns slots array with availability + price. Never returns internal IDs. **Not cached — always fresh.** |
| `/api/v1/bookings` | POST | `api/v1/bookings/route.ts` | Customer session required. multipart/form-data. Rate limited: 10/hour. Server calculates price and derives account ownership from the session. File upload non-blocking. Always returns reference. |
| `/api/v1/bookings/proof` | POST | `api/v1/bookings/proof/route.ts` | Customer session required. multipart/form-data. Rate limited: 5/hour. Session account must own the booking. |
| `/api/v1/booking-status` | POST | `api/v1/booking-status/route.ts` | Customer session required. JSON body. Rate limited: 10/10min. Query is scoped to the session account; returns friendly labels only. No internal IDs. |
| `/api/health` | GET | `api/health/route.ts` | No auth. Returns status + db check. Used by UptimeRobot. |

### 5.4 Admin Routes — Implementation Requirements

All admin routes must pass through `getAdminSession()` before any processing. A missing or invalid session returns `apiError('UNAUTHORIZED', 401)`.

| Route Group | Permission Required | Audit Action |
|------------|-------------------|--------------|
| `GET /admin/bookings` | `view_bookings` | None (read) |
| `GET /admin/bookings/[id]` | `view_bookings` | None (read) |
| `POST /admin/bookings/[id]/approve` | `approve_booking` + `verify_payment` | `booking_approved` + `payment_verified` |
| `POST /admin/bookings/[id]/reject` | `reject_booking` | `booking_rejected` + `payment_rejected` |
| `POST /admin/bookings/[id]/cancel` | `cancel_booking` | `booking_cancelled` |
| `POST /admin/bookings/[id]/review` | `view_bookings` | None |
| `GET /admin/bookings/[id]/proofs` | `view_payment_proof` | None |
| `GET /admin/bookings/[id]/proofs/[proofId]/view` | `view_payment_proof` | `payment_proof_viewed` |
| `POST /admin/courts` | `manage_courts` | `court_created` |
| `PATCH /admin/courts/[id]` | `manage_courts` | `court_updated` |
| `PATCH /admin/courts/[id]/status` | `manage_courts` | `court_disabled` or `court_updated` |
| `POST /admin/pricing` | `manage_pricing` | `pricing_created` |
| `PATCH /admin/pricing/[id]` | `manage_pricing` | `pricing_updated` |
| `DELETE /admin/pricing/[id]` | `manage_pricing` | `pricing_deleted` |
| `PUT /admin/schedule/hours` | `manage_schedule` | `schedule_updated` |
| `POST /admin/schedule/blocked-dates` | `manage_schedule` | `date_blocked` |
| `POST /admin/schedule/blocked-periods` | `manage_schedule` | `period_blocked` |
| `POST /admin/schedule/maintenance` | `manage_schedule` | `maintenance_created` |
| `GET /admin/customers` | `manage_customers` | None |
| `PUT /admin/cms/settings` | `manage_cms` | `cms_updated` |
| `POST /admin/cms/faqs` | `manage_cms` | `cms_updated` |
| `POST /admin/administrators` | `manage_admins` | `admin_created` |
| `POST /admin/administrators/[id]/deactivate` | `manage_admins` | `admin_deactivated` |
| `GET /admin/audit-logs` | `view_audit_logs` | None (read) |

### 5.5 IDOR Prevention — Mandatory Checks

Every admin route that takes an entity ID in the URL must verify venue ownership:

```typescript
// In every admin route handler that takes :id:
const booking = await bookingsRepo.findByIdAndVenueId(params.id, venueConfig.id)
if (!booking) return apiError('NOT_FOUND', 404)
// Proceed only if booking belongs to this venue
```

`venueConfig.id` comes from `src/lib/config.ts` which reads `process.env.VENUE_ID` — never from the request.

### 5.6 Rate Limiting Implementation

```typescript
// src/lib/rate-limiter.ts
import { RateLimiterMemory } from 'rate-limiter-flexible'

export const bookingCreationLimiter = new RateLimiterMemory({
  points: 10, duration: 3600,  // 10/hour
})
export const bookingStatusLimiter = new RateLimiterMemory({
  points: 10, duration: 600,   // 10/10 min
})
export const proofUploadLimiter = new RateLimiterMemory({
  points: 5, duration: 3600,   // 5/hour
})
export const adminLoginLimiter = new RateLimiterMemory({
  points: 5, duration: 900, blockDuration: 900,  // 5/15 min, 15 min block
})
export const availabilityLimiter = new RateLimiterMemory({
  points: 60, duration: 60,    // 60/min
})
```

Key: always IP address (`req.headers['x-real-ip'] || req.headers['x-forwarded-for']`). The `X-Real-IP` header is set by NGINX (`proxy_set_header X-Real-IP $remote_addr`).

On rate limit exceeded: return `apiError('RATE_LIMITED', 429)` — never throw an unhandled exception.

---

## Section 6: Final Authentication Implementation Plan

### 6.1 Scope

Authentication in V1 covers two principal types: **administrator** and **customer**. Public browsing remains unauthenticated. Customers authenticate with Google Sign-In or email/password before booking submission, booking-status access, or payment-proof upload. Customer sessions use a separate iron-session cookie namespace from administrator sessions.

### 6.2 Admin Session — iron-session

**Package:** `iron-session` ^8.0.1  
**Cookie name:** `thefield_admin_session`  
**Secret:** `SESSION_SECRET` env var — minimum 64 hex characters, generated with `openssl rand -hex 64`  
**Never committed to Git.**

#### Session Data Shape

```typescript
// src/lib/auth/session.ts
export interface AdminSession {
  adminId: string    // UUID — from admin_users.id
  roleId:  string    // UUID — from admin_roles.id (cached to avoid extra query per request)
  issuedAt: number   // Date.now() at login — used for session revocation check
}
```

#### Session Options

```typescript
export const sessionOptions: SessionOptions = {
  cookieName: 'thefield_admin_session',
  password: process.env.SESSION_SECRET!,
  cookieOptions: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    path:     '/admin',   // scoped: cookie is NOT sent on public routes
    maxAge:   60 * 60 * 8,  // 8 hours
  },
}
```

#### `getAdminSession` — called at every protected endpoint

```typescript
// src/lib/auth/session.ts
export async function getAdminSession(
  req: NextRequest | Request,
): Promise<AdminSession | null> {
  const session = await getIronSession<AdminSession>(req, res, sessionOptions)
  if (!session?.adminId) return null

  // One DB query per protected request — confirms account is still active
  const admin = await adminRepo.findActiveById(session.adminId)
  if (!admin) return null

  // Session revocation check
  if (
    admin.sessions_invalidated_at &&
    session.issuedAt < admin.sessions_invalidated_at.getTime()
  ) {
    return null
  }

  // must_change_password check — routes other than /admin/change-password are blocked
  if (admin.must_change_password) {
    // Caller responsible for redirecting; return a sentinel value
    return { ...session, mustChangePassword: true } as any
  }

  return session
}
```

#### Login Flow — `POST /api/v1/admin/auth/login`

```
1. Rate-limit check: adminLoginLimiter (5/15 min per IP)
   → 429 if exceeded

2. Zod validate body: { email: z.string().email(), password: z.string().min(1) }
   → 400 if invalid

3. SELECT admin_users WHERE email = $1 AND deleted_at IS NULL
   → If not found: return generic "Invalid credentials" (constant-time delay: await bcrypt.compare(password, DUMMY_HASH))

4. Check is_active = true
   → If false: return same generic error

5. bcrypt.compare(password, password_hash)  — cost 12, ~300–400ms
   → If false: audit_log('admin_login_failed', {email, ip}); return generic error

6. Create session: { adminId, roleId, issuedAt: Date.now() }
7. await session.save()
8. UPDATE admin_users SET last_login_at, last_login_ip WHERE id = $1
9. audit_log('admin_login', {adminId, ip})
10. Return 200 { adminId, fullName, role }
```

**Timing safety:** Even on "not found", call `bcrypt.compare(password, DUMMY_HASH)` so response time is constant regardless of whether the email exists.

#### Logout Flow — `POST /api/v1/admin/auth/logout`

```
1. getAdminSession — if no session, still return 200 (idempotent)
2. audit_log('admin_logout', {adminId, ip})
3. session.destroy()
4. Return 200
```

#### `must_change_password` Enforcement

```typescript
// In admin layout.tsx server component:
const session = await getAdminSession(req)
if (!session) redirect('/admin/login')
if (session.mustChangePassword) redirect('/admin/change-password')
```

The `/admin/change-password` route is the only admin route accessible when `must_change_password = true`.

### 6.3 Customer Authentication and Booking Ownership

Customer actions use the customer session, not reference + phone verification.

```typescript
// src/lib/auth/customer-session.ts
export async function requireCustomerBookingOwnership(reference: string) {
  const session = await getCustomerSession()
  if (!session) throw new UnauthorizedError()
  // Single query: WHERE booking_reference = $1
  // AND customer_account_id = $2 (session.customerId)
  // Returns null for any mismatch — no cross-account access.
  return bookingRepo.findByReferenceAndCustomerAccount(reference, session.customerId)
}
```

Used in:
- `POST /api/v1/booking-status`
- `POST /api/v1/bookings/proof` (late upload)

### 6.4 Password Hashing

```typescript
// src/lib/auth/password.ts
import bcrypt from 'bcryptjs'

const COST_FACTOR = 12

export async function hashPassword(plaintext: string): Promise<string> {
  if (plaintext.length > 72) {
    throw new Error('Password exceeds bcrypt input limit (72 bytes)')
  }
  return bcrypt.hash(plaintext, COST_FACTOR)
}

export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash)
}

// Used during brute-force protection — consumes attacker time even on fake accounts
const DUMMY_HASH = await bcrypt.hash('dummy-never-matches', COST_FACTOR)
export async function dummyCompare(plaintext: string): Promise<void> {
  await bcrypt.compare(plaintext, DUMMY_HASH)
}
```

### 6.5 Security Headers Middleware

```typescript
// src/app/middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { nanoid } from 'nanoid'  // or crypto.randomUUID()

export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const res = NextResponse.next()

  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload',
  )
  res.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self' https://sentry.io https://*.sentry.io",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  )

  // Pass nonce to pages via header so RSC can inject it into <script> tags
  res.headers.set('x-nonce', nonce)

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

---

## Section 7: Final Authorization Implementation Plan

### 7.1 RBAC Architecture

Each admin has exactly one role. Each role has a set of named permissions stored in `admin_role_permissions`. Permissions are checked server-side at the service layer on every mutation — never only at the UI layer.

### 7.2 Permission Check Helper

```typescript
// src/lib/auth/permissions.ts
export async function requirePermission(
  session: AdminSession,
  permission: string,
): Promise<void> {
  const permissions = await permissionsRepo.getForRole(session.roleId)
  if (!permissions.includes(permission)) {
    throw new ForbiddenError(`Permission '${permission}' required`)
  }
}

// Use in route handlers:
await requirePermission(session, 'approve_booking')
await requirePermission(session, 'verify_payment')
```

**The UI hides buttons the admin cannot use** (permission-invisible UI), but hiding is cosmetic only. Every API route independently validates permissions regardless of what the UI shows.

### 7.3 Roles and Their Permissions

**`super_admin`** — all permissions  
**`admin`** — all except `manage_admins`  
**`viewer`** — `view_bookings`, `view_payment_proof`, `manage_customers`, `view_audit_logs`

Full permission list (seeded into `admin_role_permissions`):

```
view_bookings         approve_booking       reject_booking
cancel_booking        verify_payment        reject_payment
view_payment_proof    manage_courts         manage_pricing
manage_schedule       manage_customers      manage_cms
manage_admins         view_audit_logs       manage_settings
```

### 7.4 Venue Scoping — Never From Client

```typescript
// src/lib/config.ts
export const venueConfig = {
  id:                process.env.VENUE_ID!,
  slug:              process.env.VENUE_SLUG ?? 'the-field',
  bookingExpiry:     (() => {
    const v = process.env.BOOKING_EXPIRY_MINUTES
    if (!v) throw new Error('BOOKING_EXPIRY_MINUTES env var is not set. See OBD-002.')
    return parseInt(v, 10)
  })(),
}
```

`venueConfig.id` is injected into every service call. A client request parameter cannot override it.

### 7.5 Privilege Escalation Prevention

When creating or editing an admin account:

```typescript
// In admin.service.ts createAdmin():
// The requesting admin cannot assign a role with MORE permissions than their own
const requestorPermissions = await permissionsRepo.getForRole(session.roleId)
const targetPermissions = await permissionsRepo.getForRole(targetRoleId)
const canAssign = targetPermissions.every(p => requestorPermissions.includes(p))
if (!canAssign) throw new ForbiddenError('Cannot assign a role with elevated permissions')
```

### 7.6 Authorization Decision Matrix

| Actor | Resource | Action | Rule |
|-------|----------|--------|------|
| Customer (no session) | Any booking | View status or upload proof | 401 — sign in required |
| Customer (authenticated) | Own booking | View status or upload proof | Session account ID must match |
| Customer (authenticated) | Another booking | Any | Always denied — query returns null |
| Customer | Admin endpoint | Any | No admin session cookie → 401 |
| Admin (viewer) | Booking | Approve | 403 — lacks `approve_booking` |
| Admin (admin) | Booking | Approve | Allowed — has `approve_booking` + `verify_payment` |
| Admin (admin) | Admin accounts | Create | 403 — lacks `manage_admins` |
| Admin (super_admin) | All | All | Allowed |
| System (cron) | Expired bookings | Expire | No session — runs as trusted system process |

---

## Section 8: Final Booking Implementation Plan

### 8.1 Booking Engine Core Principles

The booking engine is the highest-risk component. Every rule below is non-negotiable:

1. **Authenticated account ownership is server-authoritative.** `POST /api/v1/bookings` requires a customer session and derives `customer_account_id` from it; request data cannot supply or override it.
2. **Price is server-authoritative.** The API schema for `POST /api/v1/bookings` contains no price field.
3. **Availability is checked inside the transaction.** Not before it; not separately.
4. **The exclusion constraint is the final guard.** If application logic has a bug, the DB prevents the conflicting insert.
5. **Timezone is Africa/Cairo throughout.** All date/time math happens in this timezone.
6. **Booking reference prefix comes from `venues.booking_ref_prefix`.** Never a constant.

### 8.2 `POST /api/v1/bookings` — Full Server Validation Sequence

```
1. Require customer session; return 401 if absent. Preserve pre-auth slot selection only as intent, then revalidate it below.

2. Rate limit: bookingCreationLimiter (10/hour per IP)

3. Parse multipart/form-data:
   text fields: courtId, date, startTime, endTime, customerName, customerPhone
   file field:  paymentProof (optional)

4. Zod validation:
   courtId:       z.string().uuid()
   date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
   startTime:     z.string().regex(/^([01]\d|2[0-3]):00$/)  ← hour-aligned only
   endTime:       z.string().regex(/^([01]\d|2[0-3]):00$/)
   customerName:  z.string().min(2).max(100).trim()
   customerPhone: z.string().regex(EGYPTIAN_PHONE_REGEX)
   
   EGYPTIAN_PHONE_REGEX = /^01[0-2,5][0-9]{8}$/

5. Cross-field validation (service layer):
   a. startTime < endTime (adjacent hours only in V1: endTime = startTime + 1h)
   b. date is not in the past (compare against NOW() in Africa/Cairo)
   c. court exists and is_active = true (courts.service.assertCourtActive)
   d. date is not in blocked_dates for this venue
   e. date falls on an active operating_hours day
      → If operating_hours table is empty: return 503 "Booking not available — venue schedule not yet configured"
   f. startTime/endTime fall within operating hours for that day
   g. slot is not within a blocked_time_period for this court or all courts
   h. slot is not within a maintenance_period for this court

6. Price calculation (server-authoritative):
   pricing.service.calculatePrice(courtId, date, startTime)
   → Returns priceAmount: number
   → Throws NoPricingConfiguredError if no rules match → return 400

7. BEGIN SERIALIZABLE TRANSACTION:
   a. SELECT id FROM bookings
         WHERE court_id = $courtId
           AND status IN ('pending','payment_submitted','under_review','approved')
           AND booking_range && tstzrange(
                 (date::date + startTime::time) AT TIME ZONE 'Africa/Cairo',
                 (date::date + endTime::time)   AT TIME ZONE 'Africa/Cairo'
               )
         FOR UPDATE
      → If any rows returned: ROLLBACK → return 409 BOOKING_CONFLICT

    b. Confirm or update the authenticated customer's account profile; do not create or identify an account from request fields.
   
   c. INSERT bookings (
          venue_id, court_id, customer_account_id,
         booking_date, start_time, end_time,
         price_amount, currency, status = 'pending',
         booking_reference = generateRef(venue.booking_ref_prefix, date),
         expires_at = NOW() + interval '$BOOKING_EXPIRY_MINUTES minutes',
         ip_address, user_agent
      )
   
   d. INSERT payment_records (booking_id, amount = priceAmount, payment_method = 'instapay', status = 'pending')
   
   e. COMMIT

8. [NON-BLOCKING] If paymentProof file present:
   a. Validate: size ≤ 10MB, MIME via magic bytes (image/jpeg|image/png|application/pdf), no SVG
   b. Generate key: proofs/{bookingId}/{ulid()}.{ext}
   c. Upload to private storage
   d. If upload succeeds:
      → INSERT payment_proofs
      → UPDATE payment_records SET status = 'submitted', proof_submitted_at = NOW()
      → UPDATE bookings SET status = 'payment_submitted'
      → bookingStatus = 'payment_submitted'
   e. If upload fails:
      → Log error to Sentry
      → bookingStatus remains 'pending'
      → Customer message: "Booking received — please upload your payment proof"

8. audit.service.log('booking_created', { bookingId, customerId, courtId, adminId: null })

9. Return 201 {
     bookingReference,
     courtName,
     date,
     startTime,
     endTime,
     priceAmount,
     currency,
     bookingStatus,   ← either 'pending' or 'payment_submitted'
     paymentStatus,
   }
```

### 8.3 Booking Expiry Job

```typescript
// src/jobs/expire-bookings.ts
import cron from 'node-cron'
import { db } from '@/lib/db/client'
import { bookings } from '@/db/schema/bookings'
import { audit } from '@/modules/audit/audit.service'
import { venueConfig } from '@/lib/config'
import { logger } from '@/lib/logger'

const INTERVAL = process.env.BOOKING_EXPIRY_JOB_INTERVAL_MINUTES ?? '15'

export function startExpiryJob() {
  cron.schedule(`*/${INTERVAL} * * * *`, async () => {
    logger.info('expire-bookings: running')
    try {
      const expired = await db
        .update(bookings)
        .set({ status: 'expired', updated_at: new Date() })
        .where(
          and(
            eq(bookings.status, 'pending'),
            lt(bookings.expires_at, new Date()),
          ),
        )
        .returning({ id: bookings.id, reference: bookings.booking_reference })

      for (const b of expired) {
        await audit.log({
          action: 'booking_expired',
          entityType: 'booking',
          entityId: b.id,
          adminId: null,
          metadata: { reason: 'payment_timeout' },
        })
      }

      // Sentry heartbeat: confirms job ran
      if (process.env.SENTRY_CRON_MONITOR_ID) {
        Sentry.captureCheckIn({ monitorSlug: 'expire-bookings', status: 'ok' })
      }

      logger.info({ count: expired.length }, 'expire-bookings: complete')
    } catch (err) {
      logger.error(err, 'expire-bookings: failed')
      Sentry.captureException(err)
    }
  })
}
```

Start in `src/instrumentation.ts` (Next.js server-side instrumentation hook):

```typescript
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startExpiryJob } = await import('./jobs/expire-bookings')
    startExpiryJob()
  }
}
```

### 8.4 Booking Approval Transaction — Concurrent Safety

```typescript
// src/modules/bookings/bookings.service.ts
async function approveBooking(
  bookingId: string,
  adminId: string,
  venueId: string,
): Promise<ApproveResult> {

  // 1. Load booking — IDOR check included (must belong to venue)
  const booking = await bookingsRepo.findByIdAndVenueId(bookingId, venueId)
  if (!booking) throw new NotFoundError()

  // 2. State machine guard
  assertTransitionAllowed(booking.status, 'approved', 'admin')
  // Throws BookingTransitionForbiddenError if not allowed

  // 3. SERIALIZABLE transaction
  return db.transaction(async (tx) => {

    // 4. Fresh conflict check (re-reads current DB state inside transaction)
    const conflicting = await tx
      .select({ id: bookings.id, reference: bookings.booking_reference })
      .from(bookings)
      .where(
        and(
          eq(bookings.courtId, booking.court_id),
          eq(bookings.status, 'approved'),
          sql`${bookings.bookingRange} && ${booking.bookingRange}`,
          ne(bookings.id, bookingId),
        ),
      )
      .for('update')

    if (conflicting.length > 0) {
      throw new BookingConflictError(conflicting[0].reference)
    }
    // Note: if the exclusion constraint fires instead (concurrent admin approval race),
    // PostgreSQL throws error code 23P01 which the caller catches and maps to HTTP 409.

    // 5. Update booking
    await tx.update(bookings)
      .set({
        status: 'approved',
        approved_by: adminId,
        approved_at: new Date(),
        expires_at: null,  // clear expiry once approved
      })
      .where(eq(bookings.id, bookingId))

    // 6. Update payment record (idempotent — may already be verified)
    await tx.update(paymentRecords)
      .set({
        status: 'verified',
        verified_by: adminId,
        verified_at: new Date(),
      })
      .where(
        and(
          eq(paymentRecords.bookingId, bookingId),
          ne(paymentRecords.status, 'verified'),
        ),
      )

    // 7. Audit (inside transaction — atomicity)
    await audit.logTx(tx, 'booking_approved',  { entityId: bookingId, adminId })
    await audit.logTx(tx, 'payment_verified',  { entityId: bookingId, adminId })

    return { success: true }
  }, { isolationLevel: 'serializable' })
}
```

**Catching the PostgreSQL exclusion violation:**

```typescript
// In the API route handler:
try {
  await bookingsService.approveBooking(id, session.adminId, venueConfig.id)
  return apiSuccess({ message: 'Booking approved' })
} catch (err) {
  if (err instanceof BookingTransitionForbiddenError) {
    return apiError('STATE_TRANSITION_INVALID', 422, err.message)
  }
  if (err instanceof BookingConflictError) {
    return apiError('BOOKING_CONFLICT', 409, `Slot already confirmed for booking ${err.conflictingRef}`)
  }
  // PostgreSQL exclusion constraint violation (concurrent approval race)
  if ((err as any)?.code === '23P01') {
    return apiError('BOOKING_CONFLICT', 409, 'This slot was confirmed by another action. Please refresh.')
  }
  throw err  // Sentry captures unhandled errors
}
```

### 8.5 State Machine — Complete Transition Table

```typescript
// src/modules/bookings/booking.state-machine.ts

type BookingStatus = 'pending' | 'payment_submitted' | 'under_review' |
                     'approved' | 'rejected' | 'cancelled' | 'expired'
type Actor = 'customer' | 'admin' | 'system'

const ALLOWED: Set<string> = new Set([
  'pending→payment_submitted:customer',
  'pending→expired:system',
  'pending→rejected:admin',          // admin can reject without proof if needed
  'payment_submitted→under_review:admin',
  'payment_submitted→approved:admin',
  'payment_submitted→rejected:admin',
  'under_review→approved:admin',
  'under_review→rejected:admin',
  'approved→cancelled:admin',
])

export function assertTransitionAllowed(
  from: BookingStatus,
  to: BookingStatus,
  actor: Actor,
): void {
  const key = `${from}→${to}:${actor}`
  if (!ALLOWED.has(key)) {
    throw new BookingTransitionForbiddenError(
      `Transition ${from} → ${to} is not permitted for ${actor}`,
    )
  }
}
```

**Known accepted race:** Two concurrent `pending` booking creation requests for the same slot can both succeed. The slot is blocked from further bookings. The admin approves one and manually rejects the other. The exclusion constraint ensures only one can be `approved`. This is documented in Doc 06 and must be covered by integration tests.

### 8.6 Availability Query

```typescript
// src/modules/availability/availability.service.ts
async function getAvailableSlots(
  courtId: string,
  date: string,        // YYYY-MM-DD
  venueId: string,
): Promise<Slot[]> {

  // 1. Verify court belongs to venue (IDOR guard)
  const court = await courtsRepo.findByIdAndVenueId(courtId, venueId)
  if (!court || !court.is_active) throw new NotFoundError()

  // 2. Get operating hours for the day
  const dayOfWeek = getDayOfWeekInCairo(date)  // 0=Sun ... 6=Sat
  const hours = await venueRepo.getOperatingHoursForDay(venueId, dayOfWeek)
  if (!hours || !hours.is_active) return []  // venue closed this day

  // 3. Check blocked date
  const isBlocked = await venueRepo.isDateBlocked(venueId, date)
  if (isBlocked) return []

  // 4. Generate all hour-aligned slots within operating hours
  const allSlots = generateHourSlots(hours.open_time, hours.close_time)

  // 5. Fetch all bookings that overlap any slot on this court/date
  const existingBookings = await bookingsRepo.findActiveOnDate(courtId, date)

  // 6. Fetch blocked periods and maintenance for this court/date
  const blockedPeriods = await venueRepo.getBlockedPeriodsForCourtAndDate(venueId, courtId, date)
  const maintenance = await courtsRepo.getMaintenanceForCourtAndDate(courtId, date)

  // 7. Calculate pricing for each slot
  const pricingRules = await pricingRepo.getActiveRulesForCourt(courtId)

  // 8. Mark each slot
  return allSlots.map(slot => {
    const unavailableReason = getUnavailableReason(
      slot, existingBookings, blockedPeriods, maintenance,
    )
    const price = unavailableReason === null
      ? calculatePrice(pricingRules, parseDate(date), slot.startTime)
      : null

    return {
      startTime: slot.startTime,
      endTime:   slot.endTime,
      available: unavailableReason === null,
      reason:    unavailableReason,  // 'booked'|'blocked'|'maintenance'|null
      price,
    }
  })
}
```

`getDayOfWeekInCairo` must use the `Africa/Cairo` timezone — not the server's local time.

### 8.7 Booking Reference Generator

```typescript
// src/modules/bookings/booking.reference.ts
import { ulid } from 'ulid'

const SAFE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  // excludes 0,O,I,1

function randomSuffix(length = 4): string {
  return Array.from(
    { length },
    () => SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)],
  ).join('')
}

export function generateBookingReference(
  prefix: string,    // from venues.booking_ref_prefix
  date: Date,        // booking date
): string {
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '')
  return `${prefix}-${dateStr}-${randomSuffix()}`
}
// Collision retry is handled by the calling service:
// On unique constraint violation (booking_reference), regenerate and retry once.
```

---

## Section 9: Final Payment Proof Implementation Plan

### 9.1 Upload Pipeline — `POST /api/v1/bookings/proof`

```
1. Rate limit: proofUploadLimiter (5/hour per IP)

2. Parse multipart/form-data: reference, paymentProof (file)

3. Zod validate: reference (same schema as booking-status)

4. Verify customer session owns booking:
   requireCustomerBookingOwnership(reference)
   → 404 if no match

5. Assert booking status allows proof upload:
   status must be 'pending' or 'payment_submitted'
   → 422 STATE_TRANSITION_INVALID if not

6. File validation (all server-side):
   a. File present (required for this endpoint)
   b. Size: buffer.byteLength ≤ 10_485_760 (10MB)
   c. MIME: use file-type library on first 4100 bytes:
      Allowed: 'image/jpeg', 'image/png', 'application/pdf'
      REJECT: 'image/svg+xml' explicitly + anything not in allowlist
   d. Extension normalisation: .jpg / .png / .pdf (server-generated)
   e. Original filename is stored for reference but NEVER used in storage key

7. Generate storage key:
   key = `proofs/${bookingId}/${ulid()}.${normalizedExt}`

8. Upload to PRIVATE storage bucket:
   storageService.put(key, fileBuffer, detectedMimeType)
   → If upload fails: return 503 "Upload unavailable. You can retry using your booking reference."

9. BEGIN TRANSACTION:
   a. INSERT payment_proofs (payment_id, storage_key, original_filename, file_size_bytes, mime_type, uploaded_by_ip)
   b. UPDATE payment_records SET status = 'submitted', proof_submitted_at = NOW(), submitted_by_ip
   c. UPDATE bookings SET status = 'payment_submitted' WHERE status = 'pending'
      (only if was 'pending' — idempotent for 'payment_submitted')
   COMMIT

10. Return 200 {
      bookingReference,
      bookingStatus: 'payment_submitted',
      paymentStatus: 'submitted',
      message: 'Payment proof received. We will review and confirm your booking shortly.'
    }
```

### 9.2 Proof Access — `GET /api/v1/admin/bookings/[id]/proofs/[proofId]/view`

```
1. getAdminSession() → 401 if missing
2. requirePermission(session, 'view_payment_proof') → 403 if lacking
3. Load proof: SELECT * FROM payment_proofs WHERE id = $proofId
4. IDOR check: proof → payment_record → booking → verify booking.venue_id = venueConfig.id
   → 404 if not found or wrong venue
5. audit.log('payment_proof_viewed', { entityId: proofId, adminId })
6. Generate signed URL: storageService.getSignedUrl(proof.storage_key, 300)
   → URL valid for 5 minutes only
7. Return 302 redirect to signed URL
   (browser opens the proof; URL expires and cannot be shared)
```

### 9.3 StorageService Interface and Implementations

```typescript
// src/modules/storage/storage.types.ts
export interface StorageService {
  put(key: string, data: Buffer, mimeType: string): Promise<void>
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>
  getPublicUrl(key: string): string
  delete(key: string): Promise<void>
}

// src/modules/storage/storage.s3.ts — production
// Uses @aws-sdk/client-s3 + getSignedUrl from @aws-sdk/s3-request-presigner
// S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY from env vars
// Private bucket: S3_PRIVATE_BUCKET
// Public bucket:  S3_PUBLIC_BUCKET

// src/modules/storage/storage.local.ts — development fallback
// Stores files under LOCAL_STORAGE_PATH
// Generates local URLs for development viewing
// NEVER used in production

// Factory: selected by STORAGE_PROVIDER env var ('s3' | 'local')
// src/modules/storage/storage.service.ts
export const storageService: StorageService =
  process.env.STORAGE_PROVIDER === 'local'
    ? new LocalDiskStorageService()
    : new S3StorageService()
```

### 9.4 File Type Validation Detail

```typescript
// src/lib/validation/file.ts
import { fileTypeFromBuffer } from 'file-type'

const ALLOWED_PROOF_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
])

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg':     'jpg',
  'image/png':      'png',
  'application/pdf': 'pdf',
}

export async function validateProofFile(buffer: Buffer): Promise<{
  mimeType: string
  extension: string
}> {
  if (buffer.byteLength > 10_485_760) {
    throw new ValidationError('File exceeds 10MB limit')
  }

  const detected = await fileTypeFromBuffer(buffer)

  if (!detected || !ALLOWED_PROOF_MIMES.has(detected.mime)) {
    throw new ValidationError(
      `File type not allowed. Upload JPEG, PNG, or PDF only.`
    )
  }

  // Extra: explicitly reject SVG even if magic bytes are somehow bypassed
  if (detected.mime === 'image/svg+xml') {
    throw new ValidationError('SVG files are not accepted.')
  }

  return {
    mimeType:  detected.mime,
    extension: MIME_TO_EXT[detected.mime],
  }
}
```

### 9.5 CMS Image Upload Pipeline (Admin Gallery)

Same validation pattern as proof upload, but:
- Allowed MIME: `image/jpeg`, `image/png`, `image/webp`
- Max size: **5MB**
- After validation: resize to max 2000px and convert to WebP using `sharp`
- Storage key: `cms/gallery/{ulid()}.webp`
- Stored in **PUBLIC bucket**
- No signed URL needed — public CDN URL returned

---

## Section 10: Final CMS Implementation Plan

### 10.1 Content Architecture

The CMS has two layers:

**Layer A — Key-Value Settings** (`cms_site_settings` table)  
For singular, named pieces of content: venue name, phone, InstaPay number, hero headline, etc.

**Layer B — Collections** (`cms_faqs`, `cms_gallery_items`, `cms_events`, `cms_announcements`, `cms_social_links`)  
For repeating structured content.

All content is scoped to `venue_id = venueConfig.id`. The admin never sees or selects a venue — it is implicit.

### 10.2 Pending Business Values in CMS

The following CMS keys must start **empty or with a clearly marked placeholder** — never with invented business values:

| Key | Reason |
|-----|--------|
| `venue.instapay_number` | OBD pending — cannot invent a real InstaPay number |
| `venue.instapay_account_name` | Pending |
| `venue.instapay_instructions` | Pending |
| `venue.phone` | Pending |
| `venue.whatsapp` | Pending |
| `venue.address` | Pending |
| `homepage.hero_headline` | Pending (language decision OBD-003 unresolved) |
| `homepage.hero_subtitle` | Pending |

**The public checkout screen must check that `venue.instapay_number` is configured before displaying payment instructions.** If the key is empty, show: "Payment instructions are being configured. Please contact the venue directly."

### 10.3 CMS Service Contract

```typescript
// src/modules/cms/cms.service.ts

// Settings
getSetting(venueId: string, key: string): Promise<string | null>
getSettingGroup(venueId: string, group: string): Promise<Record<string, string | null>>
updateSetting(venueId: string, key: string, value: string, adminId: string): Promise<void>
updateSettingGroup(venueId: string, settings: Record<string, string>, adminId: string): Promise<void>
// updateSetting must:
//   1. Validate value against key-specific rules (e.g., phone format for instapay_number)
//   2. Write to cms_site_settings
//   3. Append to audit_logs (action: 'cms_updated', old_value, new_value)
//   4. Call revalidateTag(`cms-${venueId}`) for Next.js cache invalidation

// Collections (same audit + revalidation pattern for all)
getFaqs(venueId: string, publishedOnly: boolean): Promise<Faq[]>
createFaq(venueId: string, data: CreateFaqInput, adminId: string): Promise<Faq>
updateFaq(id: string, venueId: string, data: UpdateFaqInput, adminId: string): Promise<Faq>
deleteFaq(id: string, venueId: string, adminId: string): Promise<void>
reorderFaqs(venueId: string, orderedIds: string[], adminId: string): Promise<void>

getGalleryItems(venueId: string, publishedOnly: boolean): Promise<GalleryItem[]>
createGalleryItem(venueId: string, data: CreateGalleryInput, adminId: string): Promise<GalleryItem>
deleteGalleryItem(id: string, venueId: string, adminId: string): Promise<void>

getEvents(venueId: string, publishedOnly: boolean): Promise<Event[]>
createEvent / updateEvent / deleteEvent  // same pattern

getActiveAnnouncements(venueId: string): Promise<Announcement[]>  // is_published AND (expires_at IS NULL OR expires_at > NOW())
createAnnouncement / updateAnnouncement / deleteAnnouncement

getSocialLinks(venueId: string): Promise<SocialLink[]>
upsertSocialLink(venueId: string, platform: string, url: string, isActive: boolean, adminId: string): Promise<void>
```

**IDOR guard in all CMS write operations:**  
Every `updateFaq(id, venueId, ...)` must verify the record's `venue_id` matches `venueConfig.id` before updating.

### 10.4 Public Page Data Loading Pattern

All customer-facing pages are React Server Components. They fetch from the DB directly via service functions — no client-side CMS API calls.

```typescript
// app/(public)/page.tsx
export default async function HomePage() {
  const [hero, about, announcements, activeCourts] = await Promise.all([
    cms.getSettingGroup(venueConfig.id, 'homepage'),
    cms.getSettingGroup(venueConfig.id, 'about'),
    cms.getActiveAnnouncements(venueConfig.id),
    courts.getActiveCourts(venueConfig.id),
  ])
  // Gracefully handle null/empty values — never throw on missing CMS content
  return <main>...</main>
}
```

**Cache tagging:**

```typescript
// Wrap DB calls that can be cached with unstable_cache:
const getCachedSettingGroup = unstable_cache(
  (venueId: string, group: string) => cmsRepo.getSettingGroup(venueId, group),
  ['cms-settings'],
  { tags: [`cms-${venueConfig.id}`], revalidate: 60 },  // 60s fallback
)
```

**Cache invalidation on CMS save:**

```typescript
// In cms.service.ts updateSetting():
await revalidateTag(`cms-${venueId}`)
```

### 10.5 Graceful Degradation Rules

The public website must never crash due to missing CMS content. Rules:

| Situation | Behaviour |
|-----------|-----------|
| `homepage.hero_headline` is null | Show fallback: "Welcome to The Field" |
| `venue.instapay_number` is null | Show: "Please contact the venue for payment details" — prevent booking submission |
| `operating_hours` table empty | Show: "Opening hours coming soon" on About page; block booking flow |
| No active courts | Show: "Courts coming soon" on Courts page; booking flow not accessible |
| No pricing rules for a court | Return 400 "This court is not yet available for booking" |
| Gallery empty | Show: "Gallery coming soon" |
| No FAQs | Omit FAQ section entirely |

### 10.6 HTML Sanitisation for CMS Rich Text

The `about.body` field and any other CMS field with `value_type = 'markdown'` must be sanitised before storage and before rendering:

```typescript
// src/lib/cms-sanitize.ts
import sanitizeHtml from 'sanitize-html'

const ALLOWED_TAGS = ['p','h2','h3','ul','ol','li','strong','em','a','br']
const ALLOWED_ATTRS = { 'a': ['href', 'target', 'rel'] }

export function sanitizeCmsHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedSchemes: ['https'],  // no http, no javascript:
    transformTags: {
      'a': (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' },
      }),
    },
  })
}
```

Sanitisation is applied **at write time** (on CMS save) and the sanitised output is stored. The stored value is then safe to render with `dangerouslySetInnerHTML` in the admin preview — and safe to render as `{text}` in the public site (React will escape it further).

---

## Section 11: Final Admin Implementation Plan

### 11.1 Admin Dashboard Overview

The admin dashboard is a protected Next.js route group at `/admin/**`. Every page in this group is a React Server Component that:

1. Calls `getAdminSession()` server-side.
2. Redirects to `/admin/login` if no valid session.
3. Redirects to `/admin/change-password` if `must_change_password = true`.
4. Passes `session` to components that need permission-aware rendering.

The dashboard is designed exclusively for managing **The Field**. No venue selector. No platform-level views. Every query is automatically scoped to `venueConfig.id`.

### 11.2 Admin Layout Auth Guard

```typescript
// src/app/admin/layout.tsx
import { getAdminSession } from '@/lib/auth/session'
import { redirect } from 'next/navigation'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession()

  if (!session) redirect('/admin/login')
  if ((session as any).mustChangePassword) redirect('/admin/change-password')

  return (
    <div className="admin-shell">
      <AdminSidebar session={session} />
      <main className="admin-content">{children}</main>
      <PendingBookingsBanner session={session} />
    </div>
  )
}
```

`PendingBookingsBanner` fetches the count of `payment_submitted` + `under_review` bookings on every page load (server-side). If count > 0, it renders: **"X booking requests are awaiting review."** with a link to `/admin/bookings`.

### 11.3 Dashboard Page — Data Requirements

**Route:** `/admin/dashboard`

Parallel data fetches (all scoped to `venueConfig.id`):

```typescript
const [todayConfirmed, pendingCount, proofPendingCount, upcoming] = await Promise.all([
  bookingsRepo.countByStatusAndDate('approved', today, venueConfig.id),
  bookingsRepo.countByStatuses(['payment_submitted', 'under_review'], venueConfig.id),
  paymentsRepo.countByStatus('submitted', venueConfig.id),
  bookingsRepo.getUpcoming(venueConfig.id, 7),  // next 7 days, approved only
])
```

No sensitive customer phone numbers on the summary cards. Phone numbers appear only on the booking detail page.

### 11.4 Booking Management — Key Implementation Details

#### Booking List (`/admin/bookings`)

- Server-rendered, paginated (25/page).
- Default filter: `status IN ('payment_submitted', 'under_review')` — the action queue.
- Filters: status (multi), court, date range, search (name / phone / reference).
- Columns: Reference | Customer Name | Court | Date | Time | Price | Payment Status | Booking Status | Submitted | Actions.
- Quick action buttons visible only when the relevant transition is allowed:
  - `[Approve]` — visible if status is `payment_submitted` or `under_review` AND admin has `approve_booking`.
  - `[Reject]` — visible if status is rejectable AND admin has `reject_booking`.

#### Booking Detail (`/admin/bookings/[id]`)

Sections rendered:
1. **Booking Information** — reference, court, date, time, price, created at.
2. **Customer Information** — full name, phone. (Requires `view_bookings` permission to see phone.)
3. **Payment Information** — method, amount, payment status, submitted at.
4. **Payment Proof** — proof thumbnail / PDF indicator, upload date, file size. Clicking "View Proof" triggers `GET /admin/bookings/[id]/proofs/[proofId]/view` which redirects to a 5-minute signed URL.
5. **Status History** — timeline of all status transitions with timestamps and actor names.
6. **Actions** — dynamically rendered based on current status and admin permissions.

Action buttons and their server-side requirements:

| Button | Visible When | Required Permission | Server Action |
|--------|-------------|--------------------|----|
| Verify Payment & Approve | `payment_submitted` or `under_review`, has proof | `approve_booking` + `verify_payment` | `/approve` |
| Reject | `pending`, `payment_submitted`, `under_review` | `reject_booking` | `/reject` |
| Cancel | `approved` | `cancel_booking` | `/cancel` |
| Mark Under Review | `payment_submitted` | `view_bookings` | `/review` |

All destructive actions (reject, cancel) show a confirmation modal with a reason field before submitting.

#### Reject Dialog — Required Reason

```
Reject Booking #TF-XXXXXX

Reason (required):
  ○ Payment amount does not match
  ○ Payment proof is not legible
  ○ Payment proof appears fraudulent
  ○ Duplicate booking request
  ○ Other

[ Custom reason (if Other): _________________ ]

[ Confirm Rejection ]   [ Cancel ]
```

Rejection reason is stored in `bookings.rejection_reason` and `payment_records.rejection_reason`.

### 11.5 Court Management — Implementation Details

**Route:** `/admin/courts`

- List all courts for venue (including disabled; toggle to show soft-deleted).
- Add/Edit form validates: name uniqueness via the partial unique index (`uq_court_name_per_venue_active`).
- On disable: shows warning if upcoming confirmed bookings exist on that court.
- Photos: each court can have multiple images. Stored as gallery-type entries with `entity_type = 'court'` and `entity_id = court.id`. Displayed in court detail pages.

### 11.6 Pricing Management — Implementation Details

**Route:** `/admin/pricing`

Grouped by court. For each court:
- List of active pricing rules with: label, price, applicable days, time range, priority.
- Create/Edit form validates:
  - `start_time < end_time`.
  - `price > 0`.
  - At least one day selected.
- Tooltip on edit: "Price changes only affect future bookings. Existing bookings keep their stored price."
- Delete = soft delete (`deleted_at = NOW()`).

The pricing calculator logic must handle overlapping rules via the `priority` column. A test fixture with overlapping rules is required.

### 11.7 Schedule Management — Implementation Details

**Operating Hours (`/admin/schedule/hours`):**
- 7-day grid. Each day: Open/Closed toggle, Open Time, Close Time.
- On save: UPSERT `operating_hours`. If a day is marked Closed, set `is_active = false`.
- Warn if no days are configured as open.

**Blocked Dates (`/admin/schedule/blocked-dates`):**
- Calendar view showing blocked dates highlighted.
- Add: date picker + reason.
- Delete: removes the row. Slot immediately available again.
- Warn if a confirmed booking exists on the date being blocked (do not auto-cancel).

**Blocked Periods (`/admin/schedule/blocked-periods`):**
- Form: "Apply to: All Courts / [Court dropdown]", start datetime, end datetime, reason.
- Stored with `court_id = NULL` for "all courts".

**Maintenance Periods (`/admin/schedule/maintenance`):**
- Form: court (required), start datetime, end datetime, reason.
- On save: query confirmed bookings within the period. If any exist, show warning listing them. Admin must manually cancel conflicting bookings — system does not auto-cancel.

### 11.8 Administrator Management — Implementation Details

**Route:** `/admin/administrators` — requires `manage_admins` (super_admin only)

Create admin:
- Form: full name, email, temporary password, role.
- Server: hash password at cost 12, set `must_change_password = true`.
- Audit: `admin_created`.

Deactivate admin:
- Sets `is_active = false` AND `sessions_invalidated_at = NOW()`.
- All active sessions for that admin become invalid on next request.
- Confirmation dialog: "This will prevent [Name] from logging in immediately."

**Last super_admin guard:** If only one `super_admin` exists, prevent deactivation with error: "Cannot deactivate the only active super administrator."

### 11.9 Audit Log Viewer — Implementation Details

**Route:** `/admin/audit-logs` — requires `view_audit_logs`

- Table: Timestamp | Admin Name | Action | Entity Type | Entity | IP | Details.
- Filters: admin (dropdown), action type (dropdown), entity type, date range.
- Expandable rows: show `old_value` and `new_value` JSON diff (formatted, not raw).
- Read-only. No edit, delete, or export controls.
- Pagination: 50 per page, ordered by `created_at DESC`.

### 11.10 Admin UI Design Standards

| Standard | Implementation Rule |
|----------|-------------------|
| Button labels describe outcomes | "Approve & Confirm Booking" not "Approve" |
| Destructive actions need confirmation | Modal with summary before submit |
| Permission-invisible UI | Use `hasPermission(session, 'permission')` helper to conditionally render controls |
| Toast feedback | Every API action (success or error) shows a toast notification |
| Human-readable status labels | Map enum values: `payment_submitted` → "Payment Submitted – Needs Verification" |
| Mobile-capable | Admin dashboard must function on a tablet. Minimum usable on a phone (for proof review on the go). |
| Loading states | Show skeleton loaders on data-fetching pages; disable buttons during pending requests |
| Empty states | Show clear empty-state messages instead of blank tables |

```typescript
// src/lib/auth/permissions.ts — client-safe helper (no DB call)
export function hasPermission(
  session: AdminSession,
  permission: string,
  rolePermissions: string[],  // pre-loaded in layout
): boolean {
  return rolePermissions.includes(permission)
}
```

Permissions for the current session are loaded once in `AdminLayout` and passed down as a prop or through React context — avoiding per-component DB calls.

---

## Section 12: Final Testing Implementation Plan

### 12.1 Test Infrastructure

```
tests/
├── unit/             ← pure function tests, no DB, no HTTP
├── integration/      ← real DB (testcontainers), real HTTP (supertest)
├── e2e/              ← full browser (Playwright)
└── fixtures/
    ├── factories/    ← typed test data builders
    ├── files/        ← proof.jpg, proof.png, proof.pdf, malicious.php, oversized.jpg (11MB)
    └── seed-test-db.ts
```

**Test database:** Each integration test suite runs against a dedicated PostgreSQL container (testcontainers). The container is started once per suite and torn down after. Database is reset between test cases using transactions (BEGIN at start, ROLLBACK at end) where possible, or truncation where not.

**Vitest configuration:** `vitest.config.ts` defines two projects: `unit` (fast, no DB) and `integration` (slower, real DB). CI runs them sequentially.

### 12.2 Unit Tests — Complete List

#### Booking State Machine (`tests/unit/modules/booking/booking-state-machine.test.ts`)

```typescript
// All allowed transitions succeed
describe('allowed transitions', () => {
  it('pending → payment_submitted by customer')
  it('pending → expired by system')
  it('pending → rejected by admin')
  it('payment_submitted → under_review by admin')
  it('payment_submitted → approved by admin')
  it('payment_submitted → rejected by admin')
  it('under_review → approved by admin')
  it('under_review → rejected by admin')
  it('approved → cancelled by admin')
})

// All forbidden transitions throw
describe('forbidden transitions', () => {
  it('customer cannot approve their own booking')
  it('customer cannot reject a booking')
  it('customer cannot cancel a booking')
  it('admin cannot approve from pending (no proof)')
  it('system cannot approve a booking')
  it('cannot transition from terminal state: rejected')
  it('cannot transition from terminal state: cancelled')
  it('cannot transition from terminal state: expired')
  it('cannot transition approved → approved (already approved)')
})
```

#### Price Calculator (`tests/unit/modules/pricing/price-calculator.test.ts`)

```typescript
describe('calculatePrice', () => {
  it('returns matching rule price for correct day and time')
  it('returns base price when no peak rule matches time')
  it('uses higher-priority rule when two rules overlap')
  it('uses day-specific rule over general rule on matching day')
  it('throws NoPricingConfiguredError when no rules configured')
  it('throws NoPricingConfiguredError when rules exist but none match slot')
  it('correctly identifies Friday (day 5) in Africa/Cairo timezone')
  it('correctly identifies Sunday (day 0) in Africa/Cairo timezone')
  it('handles booking at midnight boundary (23:00)')
})
```

#### Slot Generator (`tests/unit/modules/availability/slot-generator.test.ts`)

```typescript
describe('generateHourSlots', () => {
  it('generates correct slots for 08:00-22:00 (14 slots)')
  it('generates single slot for 20:00-21:00')
  it('handles midnight closing (23:00-00:00 edge case)')
  it('returns empty array when open_time equals close_time')
  it('returns empty array when no operating hours configured')
})
```

#### Conflict Detector (`tests/unit/modules/availability/conflict-detector.test.ts`)

```typescript
describe('hasTimeOverlap', () => {
  it('detects identical slot as overlap')
  it('detects partial overlap at start')
  it('detects partial overlap at end')
  it('detects containment (one slot inside another)')
  it('allows adjacent slots: 18:00-19:00 and 19:00-20:00 do NOT overlap')
  it('allows non-adjacent earlier slot')
  it('allows non-adjacent later slot')
})
```

#### Booking Reference Generator (`tests/unit/modules/booking/booking-reference.test.ts`)

```typescript
describe('generateBookingReference', () => {
  it('uses prefix from venue record not a constant')
  it('format matches TF-YYYYMMDD-XXXX pattern')
  it('suffix uses only safe characters (no 0,O,I,1)')
  it('produces unique references across 10000 generations (statistical)')
})
```

#### Permission Checks (`tests/unit/auth/permissions.test.ts`)

```typescript
describe('requirePermission', () => {
  it('resolves when admin has the required permission')
  it('throws ForbiddenError when permission is absent')
  it('super_admin with all permissions passes any check')
  it('viewer with limited permissions fails approve_booking')
})
```

#### Egyptian Phone Validator (`tests/unit/lib/phone.test.ts`)

```typescript
describe('EGYPTIAN_PHONE_REGEX', () => {
  it('accepts 01012345678 (Vodafone)')
  it('accepts 01112345678 (Etisalat)')
  it('accepts 01212345678 (WE)')
  it('accepts 01512345678 (Orange)')
  it('rejects 00201012345678 (international format)')
  it('rejects 1012345678 (missing leading 0)')
  it('rejects 01012345 (too short)')
  it('rejects 010123456789 (too long)')
  it('rejects 01312345678 (invalid operator prefix)')
})
```

#### File Validator (`tests/unit/lib/file-validator.test.ts`)

```typescript
describe('validateProofFile', () => {
  it('accepts valid JPEG (magic bytes FF D8 FF)')
  it('accepts valid PNG (magic bytes 89 50 4E 47)')
  it('accepts valid PDF (magic bytes 25 50 44 46)')
  it('rejects PHP file with JPEG Content-Type (magic bytes check)')
  it('rejects SVG file')
  it('rejects file exceeding 10MB')
  it('rejects file with no detectable MIME type')
  it('rejects WEBP for proof uploads (only for gallery)')
})
```

### 12.3 Integration Tests — Complete List

#### Booking Creation (`tests/integration/api/bookings/create-booking.test.ts`)

```typescript
describe('POST /api/v1/bookings', () => {
  it('creates booking and returns TF-YYYYMMDD-XXXX reference')
  it('booking status is pending when no proof uploaded')
  it('booking status is payment_submitted when proof uploaded')
  it('stores server-calculated price, ignores any price in request body')
  it('rejects booking when court does not exist')
  it('rejects booking when court is inactive')
  it('rejects booking when date is in the past')
  it('rejects booking when date is blocked')
  it('rejects booking when slot is outside operating hours')
  it('rejects booking when slot overlaps a pending booking on same court')
  it('rejects booking when slot overlaps a payment_submitted booking on same court')
  it('rejects booking when slot overlaps an approved booking on same court')
  it('allows booking on different court at same time as existing booking')
  it('allows booking on same court on a different date')
  it('allows booking on same court in adjacent slot (not overlapping)')
  it('rejects booking when slot overlaps a blocked_time_period')
  it('rejects booking when slot overlaps a maintenance_period')
   it('returns 401 without a customer session')
   it('uses the customer account ID from the session, not the request body')
  it('returns 503 when operating_hours table is empty')
  it('returns 400 when no pricing rules configured for court')
  it('rate limits: 11th request in 1 hour returns 429')
})
```

#### Double-Booking Protection (`tests/integration/database/booking-integrity.test.ts`)

**These tests directly validate the core business guarantee.**

```typescript
describe('double-booking prevention', () => {

  it('CONCURRENT: two simultaneous requests for identical slot — exactly 1 succeeds', async () => {
    // Fire 10 parallel POST /api/v1/bookings for Court 1, same date/time
    const results = await Promise.allSettled(Array.from({ length: 10 }, () =>
      api.post('/api/v1/bookings', validPayload)
    ))
    const successes = results.filter(r => r.status === 'fulfilled' && r.value.status === 201)
    const conflicts = results.filter(r => r.status === 'fulfilled' && r.value.status === 409)
    expect(successes.length).toBe(1)
    expect(conflicts.length).toBe(9)
    // Verify only 1 booking row in DB for that slot
    const rows = await db.query.bookings.findMany({ where: /* that court+date+time */ })
    // May be 1 or 2 (pending race) but only 1 can ever reach approved
    expect(rows.filter(r => r.status !== 'rejected' && r.status !== 'expired').length).toBeLessThanOrEqual(2)
  })

  it('CONCURRENT: two simultaneous requests for overlapping (not identical) slots — both blocked from approval', async () => {
    // Booking A: 18:00–19:00; Booking B: 18:30–19:30 — should conflict
    // (Note: in V1 slots are hour-aligned, but the DB constraint handles any overlap)
    const [a, b] = await Promise.all([
      createApprovedBooking({ startTime: '18:00', endTime: '19:00' }),
      createPendingBooking({ startTime: '18:00', endTime: '19:00' }),
    ])
    // Try to approve booking B — must fail
    const res = await adminApi.post(`/api/v1/admin/bookings/${b.id}/approve`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('BOOKING_CONFLICT')
  })

  it('DATABASE: direct SQL INSERT of overlapping approved booking raises exclusion violation 23P01', async () => {
    await createApprovedBooking({ courtId, date, startTime: '19:00', endTime: '20:00' })
    await expect(
      db.execute(sql`
        INSERT INTO bookings (court_id, booking_date, start_time, end_time, status, ...)
        VALUES (${courtId}, ${date}, '19:00', '20:00', 'approved', ...)
      `)
    ).rejects.toMatchObject({ code: '23P01' })
  })

  it('ADJACENT SLOTS: booking 18:00–19:00 and 19:00–20:00 do NOT conflict', async () => {
    await createApprovedBooking({ startTime: '18:00', endTime: '19:00' })
    const res = await api.post('/api/v1/bookings', { ...payload, startTime: '19:00', endTime: '20:00' })
    expect(res.status).toBe(201)
  })

  it('DIFFERENT COURTS: same slot on different courts does NOT conflict', async () => {
    await createApprovedBooking({ courtId: court1.id, startTime: '19:00', endTime: '20:00' })
    const res = await api.post('/api/v1/bookings', { courtId: court2.id, startTime: '19:00', endTime: '20:00', ... })
    expect(res.status).toBe(201)
  })

  it('DIFFERENT DATES: same slot on different dates does NOT conflict', async () => {
    await createApprovedBooking({ date: '2026-09-10', startTime: '19:00', endTime: '20:00' })
    const res = await api.post('/api/v1/bookings', { date: '2026-09-11', startTime: '19:00', endTime: '20:00', ... })
    expect(res.status).toBe(201)
  })

  it('CANCELLED booking releases slot — new booking for same slot succeeds', async () => {
    const booking = await createApprovedBooking({ startTime: '19:00', endTime: '20:00' })
    await adminApi.post(`/api/v1/admin/bookings/${booking.id}/cancel`, { reason: 'Test' })
    const res = await api.post('/api/v1/bookings', sameSlotPayload)
    expect(res.status).toBe(201)
  })

  it('REJECTED booking releases slot — new booking for same slot succeeds', async () => {
    const booking = await createPaymentSubmittedBooking({ startTime: '19:00', endTime: '20:00' })
    await adminApi.post(`/api/v1/admin/bookings/${booking.id}/reject`, { reason: 'Test' })
    const res = await api.post('/api/v1/bookings', sameSlotPayload)
    expect(res.status).toBe(201)
  })

  it('EXPIRED booking releases slot — new booking for same slot succeeds', async () => {
    const booking = await createPendingBooking({ expiresAt: new Date(Date.now() - 1000) })
    await expireStaleBookings()
    const res = await api.post('/api/v1/bookings', sameSlotPayload)
    expect(res.status).toBe(201)
  })

  it('TWO ADMINS: concurrent approval of two bookings for same slot — second fails with 409', async () => {
    const [bookingA, bookingB] = await Promise.all([
      createPaymentSubmittedBooking(slotPayload),
      createPaymentSubmittedBooking(slotPayload),
    ])
    const [resultA, resultB] = await Promise.all([
      adminApi.post(`/api/v1/admin/bookings/${bookingA.id}/approve`),
      adminApi.post(`/api/v1/admin/bookings/${bookingB.id}/approve`),
    ])
    const statuses = [resultA.status, resultB.status].sort()
    expect(statuses).toEqual([200, 409])
  })

  it('STALE APPROVAL: admin approves booking after slot was confirmed elsewhere', async () => {
    const bookingA = await createApprovedBooking(slotPayload)  // already approved
    const bookingB = await createPaymentSubmittedBooking(slotPayload)
    const res = await adminApi.post(`/api/v1/admin/bookings/${bookingB.id}/approve`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('BOOKING_CONFLICT')
    // bookingB must still be in payment_submitted state
    const updated = await getBooking(bookingB.id)
    expect(updated.status).toBe('payment_submitted')
  })

  it('PAYMENT SUBMITTED CONFLICT: payment submitted for a booking after slot was taken', async () => {
    // Booking A is pending; another booking is approved for same slot
    const bookingA = await createPendingBooking(slotPayload)
    await createApprovedBooking(slotPayload)  // takes the slot
    // Uploading proof for bookingA is still allowed (it moves to payment_submitted)
    // But when admin tries to approve bookingA, it gets 409
    await uploadProof(bookingA)
    const res = await adminApi.post(`/api/v1/admin/bookings/${bookingA.id}/approve`)
    expect(res.status).toBe(409)
  })
})
```

#### Booking Expiry (`tests/integration/database/expiry-job.test.ts`)

```typescript
it('expires only pending bookings past expires_at')
it('does NOT expire payment_submitted bookings')
it('does NOT expire under_review bookings')
it('does NOT expire approved bookings')
it('does NOT expire bookings with future expires_at')
it('released slot is bookable after expiry')
it('creates audit log entry for each expired booking')
```

#### Admin Approval (`tests/integration/api/admin/approve-booking.test.ts`)

```typescript
it('approves booking and returns 200')
it('updates booking status to approved')
it('updates payment status to verified')
it('creates two audit log entries (booking_approved + payment_verified)')
it('clears expires_at on approval')
it('returns 401 without admin session')
it('returns 403 for viewer role')
it('returns 422 for invalid state transition (already approved)')
it('returns 409 when slot was taken between view and approval')
```

#### Payment Proof Upload (`tests/integration/api/bookings/proof-upload.test.ts`)

```typescript
it('accepts valid JPEG proof')
it('accepts valid PNG proof')
it('accepts valid PDF proof')
it('rejects file over 10MB')
it('rejects PHP file disguised as JPEG')
it('rejects SVG file')
it('rejects upload with wrong booking reference')
it('rejects upload when the authenticated account does not own the booking')
it('rejects upload when booking is approved (terminal-adjacent)')
it('allows re-upload when booking is payment_submitted (replaces active proof)')
it('rate limits: 6th upload per hour returns 429')
```

#### Price Manipulation (`tests/integration/api/bookings/price-manipulation.test.ts`)

```typescript
it('stores server-calculated price regardless of request body content')
it('stores server-calculated price when request body has price: 0')
it('stores server-calculated price when request body has price: 999999')
it('stores server-calculated price when request body has no price field')
```

#### IDOR Prevention (`tests/integration/api/security/idor.test.ts`)

```typescript
   it('booking status lookup returns 404 for another authenticated customer account')
it('admin cannot access booking from different venue (VENUE_ID scoping)')
   it('proof upload returns 404 when the session account does not own the reference')
it('admin booking detail returns 404 for booking ID not belonging to venue')
```

### 12.4 End-to-End Tests (Playwright)

```typescript
// tests/e2e/customer/full-booking-flow.spec.ts
test('customer completes booking on 390px mobile viewport', async ({ page }) => {
  // Navigate, select court, date, slot, fill form, upload proof, submit
  // Verify: booking reference displayed, format matches TF-YYYYMMDD-XXXX
  // Verify: status shows "Payment Submitted"
})

// tests/e2e/customer/booking-status-lookup.spec.ts
test('customer can look up own booking status')
test('customer cannot access another account\'s booking')
test('unauthenticated booking-status access is rejected')

// tests/e2e/customer/late-proof-upload.spec.ts
test('customer uploads proof after initial submission via status page')

// tests/e2e/admin/admin-login.spec.ts
test('admin can log in with correct credentials')
test('incorrect credentials show generic error without enumeration')
test('5 failed attempts trigger rate limit response')
test('deactivated admin cannot log in')

// tests/e2e/admin/approve-booking.spec.ts
test('admin views proof via signed URL redirect')
test('admin approves booking through full UI workflow')
test('admin sees conflict error when slot already taken')

// tests/e2e/admin/reject-booking.spec.ts
test('admin rejects booking with predefined reason')
test('admin rejects booking with custom reason')

// tests/e2e/admin/court-management.spec.ts
test('admin creates new court — appears in public courts page')
test('admin disables court — disappears from public booking flow')

// tests/e2e/admin/cms-editing.spec.ts
test('admin changes WhatsApp number — public site reflects change after cache invalidation')
test('admin adds FAQ — appears on public FAQ page')

// tests/e2e/security/unauthorized-access.spec.ts
test('unauthenticated user cannot access /admin/dashboard — redirected to /admin/login')
test('viewer role API call to approve endpoint returns 403')
test('customer direct API call to admin approve endpoint returns 401')

// tests/e2e/security/price-manipulation.spec.ts
test('intercepted booking submission with manipulated price stores correct server price')

// tests/e2e/accessibility/booking-flow.spec.ts
test('booking flow passes axe-core accessibility checks on 390px viewport')
test('admin dashboard passes axe-core accessibility checks')
```

### 12.5 Coverage Targets

| Module | Target | Priority |
|--------|--------|---------|
| `booking.state-machine.ts` | 100% | P1 |
| `pricing.calculator.ts` | 95% | P1 |
| `conflict.detector.ts` | 95% | P1 |
| `slot.generator.ts` | 90% | P1 |
| `bookings.service.ts` | 85% | P1 |
| `payments.service.ts` | 85% | P1 |
| `permissions.ts` | 90% | P1 |
| API route handlers | 75% | P1 |
| `cms.service.ts` | 70% | P2 |
| Overall project | ≥ 70% | Target |

---

## Section 13: Final Security Implementation Plan

### 13.1 Security Controls Checklist — Implementation Mapping

| Control | Where Implemented | How Verified |
|---------|-----------------|-------------|
| HTTPS only | NGINX redirect + HSTS header | securityheaders.com scan |
| Security headers | `src/app/middleware.ts` | securityheaders.com + manual |
| Session cookie flags (HttpOnly, Secure, SameSite=Lax) | `src/lib/auth/session.ts` sessionOptions | Browser DevTools + Playwright |
| Parameterised queries | Drizzle ORM (all queries) + tagged SQL template literals | Semgrep rule |
| CSRF protection | SameSite=Lax + Content-Type: application/json check | Integration test |
| Rate limiting — booking | `rate-limiter-flexible` in booking route | Integration test (429 on 11th) |
| Rate limiting — login | NGINX zone + app limiter | Integration test + manual |
| Rate limiting — availability | `rate-limiter-flexible` | Load test |
| IDOR prevention | venue_id scope on all admin queries | Integration test |
| Price authority | Price field absent from booking creation schema | Integration test |
| Status authority | Status never accepted from client | Zod schema enforcement |
| File type check | `file-type` magic bytes in `validateProofFile` | Integration test |
| File size limit | Pre-upload buffer size check | Integration test |
| Safe file names | ULID generated server-side | Code review |
| Private proof storage | S3_PRIVATE_BUCKET bucket policy | Manual R2 console check |
| Signed URL for proofs | 5-min signed URL via presigner | Integration test |
| Audit proof access | `payment_proof_viewed` audit log entry | Integration test |
| Privilege escalation | Permission comparison in `createAdmin` | Unit test |
| SQL injection | Drizzle parameterised queries | Semgrep + OWASP ZAP |
| XSS | React default escaping + CSP header + sanitize-html | E2E test + ZAP |
| Secrets in env | `.gitignore` + gitleaks pre-commit hook | gitleaks scan |
| Session revocation | `sessions_invalidated_at` check on every request | Integration test |
| bcrypt cost factor | 12 minimum, enforced in `hashPassword` | Unit test |
| Brute-force protection | App limiter (5/15min) + NGINX zone | Integration test + E2E |
| No stack traces to client | Error handler catches all; Sentry captures | Integration test |
| App DB role restrictions | `REVOKE DELETE` on bookings/payments/audit | DB integration test |
| Audit log append-only | `REVOKE UPDATE, DELETE ON audit_logs FROM app_user` | DB test |

### 13.2 Input Sanitisation Rules

| Field | Rule |
|-------|------|
| `customerName` | `z.string().min(2).max(100).trim()` — Zod enforces, React escapes on render |
| `customerPhone` | Strict regex — no HTML possible |
| `bookingReference` | Strict regex `TF-\d{8}-[A-Z0-9]{4}` |
| `reason` (reject/cancel) | `z.string().min(1).max(1000).trim()` |
| CMS text fields | Store raw; sanitize on render (React escapes by default) |
| CMS HTML/markdown fields | `sanitizeCmsHtml()` at write time |
| URL fields (social links, map embed) | `z.string().url()` — HTTPS only |
| File uploads | Magic bytes check; extension normalised server-side |

### 13.3 Content Security Policy Notes

The CSP in middleware uses `script-src 'self' 'nonce-{nonce}'`. Nonce is generated per request. This means:

- Sentry SDK must be loaded with the nonce: `<Script nonce={nonce} src="..." />`
- No inline `<script>` tags anywhere in the codebase (use React event handlers or nonce)
- Tailwind JIT styles are inlined as CSS, not script — `style-src 'unsafe-inline'` is required for Tailwind in development. In production, use `style-src 'self'` with external CSS if a build-time approach is feasible. For V1, `'unsafe-inline'` for styles is acceptable with the note that it weakens style injection protection.

### 13.4 Pre-Commit Hook Configuration

```bash
# .git/hooks/pre-commit (or via husky)
#!/bin/bash
set -e
npx tsc --noEmit          # type check
npx eslint src --max-warnings 0
gitleaks protect --staged  # scan staged files for secrets
```

### 13.5 CI Security Pipeline

```yaml
# Every push to main and every PR:
- npm ci
- npx tsc --noEmit
- npx eslint src --max-warnings 0
- npm run test:unit -- --run
- npm run test:integration -- --run
- npm audit --audit-level=high
- npx semgrep --config=p/typescript --config=p/owasp-top-ten src/
- gitleaks detect --log-opts="HEAD~1..HEAD"
- npm run build
```

### 13.6 Environment Variables Security

All secrets must be in environment variables. The following must never appear in source code:

```bash
SESSION_SECRET          # 64-char hex, openssl rand -hex 64
DATABASE_URL            # contains password
DATABASE_BACKUP_URL     # contains password
DATABASE_MIGRATION_URL  # contains password
S3_ACCESS_KEY_ID        # R2 access key
S3_SECRET_ACCESS_KEY    # R2 secret key
SENTRY_DSN              # public key OK in client, but keep in env
SENTRY_AUTH_TOKEN       # must never be public
SEED_ADMIN_EMAIL        # only needed at seed time
SEED_ADMIN_PASSWORD     # only needed at seed time, must be changed
```

Validate required env vars at startup:

```typescript
// src/lib/config.ts
const required = ['VENUE_ID', 'SESSION_SECRET', 'DATABASE_URL', 'STORAGE_PROVIDER']
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Required environment variable ${key} is not set`)
  }
}
```

---

## Section 14: Final Deployment Implementation Plan

### 14.1 Hostinger VPS Setup Sequence

**Execute once per environment (staging and production separately):**

```bash
# Step 1: Verify btree_gist availability FIRST
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"
# If this fails: install postgresql-16-contrib: apt install postgresql-16-contrib
# Do NOT proceed until this succeeds.

# Step 2: System packages
apt update && apt upgrade -y
apt install -y nginx postgresql-16 postgresql-16-contrib certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2

# Step 3: Database setup
sudo -u postgres psql << 'EOF'
CREATE DATABASE thefield;
\c thefield
-- Create roles (using actual passwords from secure password manager)
CREATE ROLE app_user LOGIN PASSWORD '${APP_DB_PASSWORD}';
CREATE ROLE backup_user LOGIN PASSWORD '${BACKUP_DB_PASSWORD}';
CREATE ROLE migration_user LOGIN PASSWORD '${MIGRATION_DB_PASSWORD}';
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT CONNECT ON DATABASE thefield TO backup_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_user;
GRANT ALL PRIVILEGES ON DATABASE thefield TO migration_user;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
EOF

# Step 4: Application setup
mkdir -p /var/www/thefield /var/backups/thefield /var/log/thefield
git clone https://github.com/ORG/thefield.git /var/www/thefield
cd /var/www/thefield

# Step 5: Set environment variables
# Edit /etc/environment OR use PM2 env file
# Set: NODE_ENV, VENUE_ID, SESSION_SECRET, DATABASE_URL, S3_*, SENTRY_DSN,
#      BOOKING_EXPIRY_MINUTES (pending OBD-002),
#      BOOKING_EXPIRY_JOB_INTERVAL_MINUTES=15
# DO NOT set BOOKING_EXPIRY_MINUTES until venue owner confirms OBD-002

# Step 6: Dependencies + build
npm ci
npm run db:migrate    # runs Drizzle migrations
npm run db:migrate:raw  # runs raw/*.sql files (booking_range + exclusion constraint)
npm run db:seed       # requires SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD env vars
npm run build

# Step 7: PM2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup systemd -u $USER --hp $HOME

# Step 8: NGINX
cp /var/www/thefield/nginx/thefield.conf /etc/nginx/sites-available/thefield
ln -sf /etc/nginx/sites-available/thefield /etc/nginx/sites-enabled/thefield
nginx -t && systemctl reload nginx

# Step 9: TLS
certbot --nginx -d thefield.eg -d www.thefield.eg --non-interactive --agree-tos -m admin@thefield.eg

# Step 10: Backup cron
crontab -e
# Add: 0 2 * * * /var/www/thefield/scripts/backup-db.sh >> /var/log/thefield/backup.log 2>&1
```

### 14.2 `.env.example` — Complete Reference

```bash
# ── Application ─────────────────────────────────────────────────────
NODE_ENV=production
PORT=3000
NEXT_PUBLIC_SITE_URL=https://thefield.eg

# ── Venue Configuration ──────────────────────────────────────────────
VENUE_ID=                          # UUID — set after db:seed runs
VENUE_SLUG=the-field

# ── Authentication ───────────────────────────────────────────────────
SESSION_SECRET=                    # 64-char hex: openssl rand -hex 64

# ── Database ─────────────────────────────────────────────────────────
DATABASE_URL=postgresql://app_user:PASSWORD@127.0.0.1:5432/thefield
DATABASE_BACKUP_URL=postgresql://backup_user:PASSWORD@127.0.0.1:5432/thefield
DATABASE_MIGRATION_URL=postgresql://migration_user:PASSWORD@127.0.0.1:5432/thefield

# ── Storage ──────────────────────────────────────────────────────────
STORAGE_PROVIDER=s3                # 's3' or 'local' (local = development only)
S3_REGION=auto
S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PRIVATE_BUCKET=thefield-private
S3_PUBLIC_BUCKET=thefield-public
S3_PUBLIC_BASE_URL=https://media.thefield.eg
# Local fallback (development only)
LOCAL_STORAGE_PATH=./storage
LOCAL_STORAGE_PUBLIC_URL=http://localhost:3000/media

# ── Monitoring ───────────────────────────────────────────────────────
SENTRY_DSN=
SENTRY_AUTH_TOKEN=                 # Required for source map uploads in CI
SENTRY_CRON_MONITOR_ID=            # Optional: Sentry cron monitor slug for expiry job

# ── Booking Engine ───────────────────────────────────────────────────
# OBD-002: PENDING — requires venue owner confirmation before setting
BOOKING_EXPIRY_MINUTES=            # e.g. 120 — DO NOT DEFAULT, leave blank
BOOKING_EXPIRY_JOB_INTERVAL_MINUTES=15

# ── Seed (used once at initial deployment only) ───────────────────────
SEED_ADMIN_EMAIL=                  # Initial super-admin email
SEED_ADMIN_PASSWORD=               # Temporary password — must be changed on first login

# ── Logging ──────────────────────────────────────────────────────────
LOG_LEVEL=info                     # 'debug' in development, 'info' in production
```

### 14.3 Deployment Script (`scripts/deploy.sh`)

```bash
#!/bin/bash
set -e  # Exit on any error

APP_DIR=/var/www/thefield
BACKUP_DIR=/var/backups/thefield
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo "[${TIMESTAMP}] Starting deployment"

# Pre-deploy database backup
echo "Backing up database..."
pg_dump "$DATABASE_BACKUP_URL" | gzip > "${BACKUP_DIR}/pre-deploy-${TIMESTAMP}.sql.gz"

# Pull latest code
cd "$APP_DIR"
git pull origin main

# Install dependencies (use exact lockfile)
npm ci

# Run migrations (Drizzle first, then raw SQL)
npm run db:migrate
npm run db:migrate:raw

# Build
npm run build

# Graceful reload (zero-downtime within the single-process limit)
pm2 reload thefield --update-env

echo "[${TIMESTAMP}] Deployment complete"
```

### 14.4 `ecosystem.config.js` (PM2)

```javascript
module.exports = {
  apps: [{
    name: 'thefield',
    script: 'node_modules/.bin/next',
    args: 'start',
    cwd: '/var/www/thefield',
    instances: 1,
    exec_mode: 'fork',            // NOT cluster — node-cron runs in this process
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    max_memory_restart: '1G',
    error_file: '/var/log/thefield/error.log',
    out_file:   '/var/log/thefield/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    restart_delay: 5000,
    max_restarts: 10,
    min_uptime: '10s',
    watch: false,
  }],
}
```

### 14.5 NGINX Configuration (`nginx/thefield.conf`)

```nginx
limit_req_zone $binary_remote_addr zone=booking_api:10m  rate=10r/m;
limit_req_zone $binary_remote_addr zone=admin_login:10m  rate=5r/m;
limit_req_zone $binary_remote_addr zone=general:10m      rate=120r/m;

server {
    listen 80;
    server_name thefield.eg www.thefield.eg;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name thefield.eg www.thefield.eg;

    ssl_certificate     /etc/letsencrypt/live/thefield.eg/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/thefield.eg/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # Belt-and-suspenders security headers (Next.js middleware sets these too)
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    client_max_body_size 12m;

    location /api/v1/bookings {
        limit_req zone=booking_api burst=5 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/v1/admin/auth/login {
        limit_req zone=admin_login burst=2 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        limit_req zone=general burst=30 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

---

## Section 15: Final Monitoring Implementation Plan

### 15.1 Monitoring Stack Summary

| Tool | Purpose | Trigger |
|------|---------|---------|
| UptimeRobot (free) | HTTP uptime check | Alerts within 5 min of downtime |
| Sentry | Error tracking, performance, release tracking | Instant on unhandled error |
| PM2 | Process health, CPU/RAM, auto-restart | Auto-restart on crash |
| PostgreSQL slow query log | Queries > 1s | Weekly review |
| pino (structured logs) | Application events | VPS disk, reviewed on incidents |
| logrotate | Log rotation | Daily, 30-day retention |

### 15.2 Sentry Configuration

```typescript
// src/instrumentation.ts
import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

      beforeSend(event) {
        // Scrub sensitive fields before sending to Sentry
        if (event.request?.data) {
          const sensitive = ['customerPhone', 'password', 'customerName', 'paymentProof']
          for (const key of sensitive) delete event.request.data[key]
        }
        return event
      },

      integrations: [
        Sentry.postgresIntegration(),  // captures slow DB queries
      ],
    })

    // Start booking expiry job (only in Node.js runtime, not Edge)
    const { startExpiryJob } = await import('./jobs/expire-bookings')
    startExpiryJob()
  }
}
```

### 15.3 Health Endpoint (`/api/health`)

```typescript
export async function GET() {
  let dbStatus = 'connected'
  try {
    await db.execute(sql`SELECT 1`)
  } catch {
    dbStatus = 'unavailable'
  }

  const status = dbStatus === 'connected' ? 'ok' : 'degraded'
  const httpStatus = status === 'ok' ? 200 : 503

  return Response.json({
    status,
    database: dbStatus,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? 'unknown',
    uptime: process.uptime(),
  }, { status: httpStatus })
}
```

### 15.4 Structured Logging Configuration

```typescript
// src/lib/logger.ts
import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      '*.password',
      '*.customerPhone',
      '*.phone_number',
      '*.storageKey',   // don't log internal storage paths
    ],
    censor: '[REDACTED]',
  },
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
})
```

**Required log events (minimum):**

| Event | Level | Fields |
|-------|-------|--------|
| Booking created | info | bookingReference, courtId, date, status |
| Booking approved | info | bookingReference, adminId |
| Booking rejected | info | bookingReference, adminId, reason |
| Booking expired | info | bookingReference |
| Payment proof uploaded | info | bookingId, fileSize, mimeType |
| Admin login success | info | adminId, ip |
| Admin login failure | warn | email (redacted), ip |
| Expiry job run | info | count of expired |
| File upload failure | error | bookingId, error message |
| DB connection error | error | full error |

### 15.5 UptimeRobot Configuration

Two monitors:

| Monitor | URL | Interval | Alert |
|---------|-----|----------|-------|
| Main site | `https://thefield.eg/api/health` | 5 min | Email + SMS to venue owner + developer |
| Admin | `https://thefield.eg/admin/login` | 5 min | Email to developer |

**Post-deployment verification:** After every deployment, confirm UptimeRobot shows the monitor as "up" within 5 minutes.

### 15.6 PostgreSQL Monitoring

```sql
-- postgresql.conf additions:
log_min_duration_statement = 1000    -- log queries taking > 1 second
log_line_prefix = '%t [%p] user=%u db=%d app=%a client=%h '
shared_preload_libraries = 'pg_stat_statements'  -- query statistics
```

Weekly review of slow query log to identify missing indexes or N+1 patterns.

### 15.7 Incident Response Quick Reference

```
SITE DOWN:
  1. Check UptimeRobot alert details
  2. SSH: pm2 status thefield
     → pm2 start thefield (if stopped)
     → pm2 logs thefield --lines 50 (if erroring)
  3. Check Sentry for triggering exception
  4. systemctl status nginx postgresql
  5. /var/log/thefield/error.log

BOOKING FAILURES:
  1. curl https://thefield.eg/api/health
  2. Check Sentry: filter to /api/v1/bookings errors
  3. Check operating_hours table is populated (OBD-004)
  4. Check BOOKING_EXPIRY_MINUTES is set (OBD-002)
  5. Check pricing rules exist for the court

SECURITY INCIDENT:
  1. Deactivate suspected admin account immediately (admin UI or direct DB)
  2. Rotate SESSION_SECRET (logs out all admins)
  3. Review audit_logs for actions by compromised account
  4. Rotate R2 and DB credentials if suspected
  5. Document all actions taken
```

---

## Section 16: Milestone Roadmap

Each milestone produces a **runnable, deployable increment** of the application. The application must start and serve requests at the end of every milestone without crashing. No milestone leaves the codebase in an unrunnable state.

Estimated total: **14–16 weeks** for 1–2 developers working full-time.

---

### Milestone 0 — Project Foundation and Development Environment
**Duration:** Week 1–2  
**Outcome:** Repository initialised, dev environment running, database migrations verified, CI passing.

**Blocking pre-conditions before any code:**
- OBD-004 (operating schedule): must be confirmed or the seed script must be written to leave `operating_hours` empty with a startup warning.
- `btree_gist` extension: verified available on the target Hostinger PostgreSQL instance.

**Tasks:**
- M0-T01 through M0-T12 (see Section 17)

**Quality Gate:** `npm run dev` starts with no errors. `npm run db:migrate && npm run db:seed` succeeds. `npm run typecheck && npm run lint` passes. CI pipeline runs and passes on an empty commit. `btree_gist` extension confirmed installed.

---

### Milestone 1 — Database, Configuration, Authentication, and Authorization Foundation
**Duration:** Week 3–4  
**Outcome:** Complete database schema deployed. Admin login, session management, and RBAC working. All auth unit and integration tests passing.

**Blocking pre-conditions:**
- Milestone 0 quality gate passed.
- OBD-002 (expiry timeout): must be confirmed OR the system must refuse to start without `BOOKING_EXPIRY_MINUTES` set (enforced in `src/lib/config.ts`).

**Tasks:**
- M1-T01 through M1-T14 (see Section 17)

**Quality Gate:** Admin can log in, see a dashboard skeleton, and log out. Session revocation works (deactivating an admin kicks them out). All auth unit tests pass. All RBAC unit tests pass. All Milestone 1 integration tests pass. Type check and lint pass. No secrets in git.

---

### Milestone 2 — The Field CMS and Public Website
**Duration:** Week 5–7  
**Outcome:** Complete public-facing website. All pages render from the database. CMS fully operational in admin dashboard. Public site gracefully handles missing CMS content.

**Blocking pre-condition:**
- OBD-003 (language decision): must be confirmed before building public UI. If Arabic or bilingual is required, RTL support must be configured in Tailwind before any components are built. Do not build English-only components and retrofit RTL later.

**Tasks:**
- M2-T01 through M2-T18 (see Section 17)

**Quality Gate:** All public pages render without error when CMS content is absent. All pages render correctly when CMS content is populated. Admin can edit every CMS field and see changes on the public site after cache revalidation. Lighthouse mobile score ≥ 80 on home and booking pages. axe-core reports no critical accessibility violations. Type check, lint, unit tests, and CMS integration tests pass.

---

### Milestone 3 — Court Availability and Booking Engine
**Duration:** Week 8–10  
**Outcome:** Complete booking engine. Availability API live. Booking creation end-to-end. Expiry job running. All double-booking tests passing.

**Blocking pre-condition:**
- OBD-002 confirmed and `BOOKING_EXPIRY_MINUTES` set in environment.
- At least one court with pricing rules created (admin can do this after Milestone 2).
- Operating hours configured in admin (after Milestone 2).

**Tasks:**
- M3-T01 through M3-T22 (see Section 17)

**Quality Gate:** Full booking flow works end-to-end on mobile. All double-booking integration tests pass (concurrent requests, adjacent slots, different courts, cancelled/rejected/expired states). Price manipulation test passes (server ignores client-submitted price). Exclusion constraint verified with direct SQL INSERT test. Expiry job runs on schedule. All Milestone 3 tests pass.

---

### Milestone 4 — InstaPay Payment Proof Workflow
**Duration:** Week 11–12  
**Outcome:** Complete payment proof upload, admin verification, and booking approval pipeline. Private storage working. Signed URL access working.

**Tasks:**
- M4-T01 through M4-T14 (see Section 17)

**Quality Gate:** Customer can upload proof (JPEG, PNG, PDF). Invalid file types rejected with error. File over 10MB rejected. Proof stored in private bucket (not publicly accessible). Admin can view proof via signed URL (redirects, expires in 5 mins). Admin can approve and reject bookings through the full UI. Concurrent admin approval test passes. All payment proof security tests pass.

---

### Milestone 5 — Admin Booking Management
**Duration:** Week 13  
**Outcome:** Complete admin booking management dashboard. Court, pricing, and schedule management. Customer management. Administrator management. Audit logs.

**Tasks:**
- M5-T01 through M5-T16 (see Section 17)

**Quality Gate:** Admin can perform the full operational loop: view booking requests → view proof → approve or reject → see booking in correct list. Admin can manage courts, pricing rules, operating hours, blocked dates, and maintenance periods. Admin management (create, deactivate, role assignment) works. Audit log records all actions. All Milestone 5 tests pass.

---

### Milestone 6 — Testing, Security Hardening, Monitoring, and Deployment
**Duration:** Week 14–16  
**Outcome:** Production-ready system. All security scans passing. Monitoring live. Staging verified. Production deployed. Manual smoke test completed.

**Tasks:**
- M6-T01 through M6-T20 (see Section 17)

**Quality Gate:** See Definition of Done (Section 19).

---

## Section 17: Task Breakdown

Each task specifies: objective, dependencies, files/modules affected, implementation requirements, and acceptance criteria (AC). Unit tests (UT), integration tests (IT), and E2E tests (E2E) are noted where required.

---

### MILESTONE 0 TASKS

---

#### M0-T01 — Verify btree_gist Extension
**Objective:** Confirm `btree_gist` is available on the target PostgreSQL instance before schema work begins.  
**Dependencies:** None  
**Files:** `scripts/verify-extensions.sh`

**Implementation:**
```bash
#!/bin/bash
psql "$DATABASE_MIGRATION_URL" -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"
psql "$DATABASE_MIGRATION_URL" -c "SELECT extname FROM pg_extension WHERE extname = 'btree_gist';"
```

**AC:** Script exits 0. `btree_gist` appears in extension list.  
**If fails:** Install `postgresql-16-contrib` package or switch to self-managed PostgreSQL. Do not proceed to M0-T04 until this passes.

---

#### M0-T02 — Initialise Next.js Project
**Objective:** Create the Next.js 14 project with TypeScript, Tailwind, ESLint, and Prettier configured to the standards defined in Section 2.  
**Dependencies:** Node.js 20 LTS installed  
**Files:** `package.json`, `tsconfig.json`, `tailwind.config.ts`, `next.config.ts`, `.eslintrc.json`, `.prettierrc`, `.gitignore`

**Implementation requirements:**
- `"strict": true` in `tsconfig.json`. No exceptions.
- Tailwind configured with `content: ['./src/**/*.{ts,tsx}']`.
- ESLint extends `@typescript-eslint/recommended` with `no-any` rule enabled.
- `.gitignore` includes: `.env*`, `/storage`, `/node_modules`, `/.next`, `drizzle/`, `*.sql.gz`.
- `package.json` scripts: `dev`, `build`, `start`, `typecheck`, `lint`, `test:unit`, `test:integration`, `test:e2e`, `db:migrate`, `db:migrate:raw`, `db:seed`, `db:studio`.

**AC:** `npm run dev` starts on port 3000. `npm run typecheck` passes. `npm run lint` passes with 0 warnings.

---

#### M0-T03 — Configure Test Infrastructure
**Objective:** Set up Vitest (unit + integration projects), Playwright, and testcontainers.  
**Dependencies:** M0-T02  
**Files:** `vitest.config.ts`, `playwright.config.ts`, `tests/fixtures/seed-test-db.ts`, `tests/fixtures/factories/`

**Implementation requirements:**
- `vitest.config.ts` defines two projects: `unit` (no DB setup) and `integration` (starts testcontainer PG before suite).
- Playwright configured for Chromium only in CI (Firefox and WebKit optional locally).
- Test factories created for: `venue`, `court`, `pricingRule`, `operatingHours`, `customer`, `booking`, `admin`, `adminRole`.
- Each factory accepts partial overrides and provides sensible defaults.
- `seed-test-db.ts` runs all migrations + seeds one venue + three admin roles + one super-admin.

**AC:** `npm run test:unit -- --run` passes (empty test suites count). `npm run test:e2e` launches Playwright and closes cleanly.

---

#### M0-T04 — Drizzle ORM Schema — All Tables
**Objective:** Define every table from the database architecture in Drizzle schema files.  
**Dependencies:** M0-T01, M0-T02  
**Files:** `src/db/schema/*.ts`, `drizzle.config.ts`

**Implementation requirements:**
- One file per table (list in Section 3).
- `src/lib/db/schema.ts` re-exports all tables for unified import.
- `bookings.ts` defines all columns **except** `booking_range` (generated column — see M0-T05).
- `admin-users.ts` includes `must_change_password BOOLEAN NOT NULL DEFAULT FALSE`.
- `audit-logs.ts` includes `payment_proof_viewed` in the `audit_action` enum.
- `venues.ts` includes `booking_ref_prefix VARCHAR(10) NOT NULL DEFAULT 'TF'`.
- Courts table uses no inline UNIQUE constraint on name (partial unique index created in raw SQL migration — M0-T05).
- `bookings.ts` comment: `// booking_range generated column and exclusion constraint are in migrations/raw/0001_booking_integrity.sql`.

**AC:** `npx drizzle-kit generate` produces valid SQL. All table relationships (FK constraints) are correct. TypeScript types infer correctly for all table rows.

---

#### M0-T05 — Raw SQL Migration: Booking Integrity Constraint
**Objective:** Create the `booking_range` generated column and the exclusion constraint that enforce double-booking prevention at the database level.  
**Dependencies:** M0-T04  
**Files:** `src/db/migrations/raw/0001_booking_integrity.sql`, `src/db/migrations/raw/0002_indexes.sql`, `scripts/migrate-raw.sh`

**Implementation requirements:**

`0001_booking_integrity.sql`:
```sql
-- Requires btree_gist (verified in M0-T01)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_range TSTZRANGE
  GENERATED ALWAYS AS (
    tstzrange(
      (booking_date + start_time) AT TIME ZONE 'Africa/Cairo',
      (booking_date + end_time)   AT TIME ZONE 'Africa/Cairo'
    )
  ) STORED;

ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS no_overlapping_approved_bookings;

ALTER TABLE bookings
  ADD CONSTRAINT no_overlapping_approved_bookings
  EXCLUDE USING GIST (
    court_id      WITH =,
    booking_range WITH &&
  ) WHERE (status = 'approved');
```

`0002_indexes.sql`:
```sql
-- Partial unique index for courts (replaces broken UNIQUE with deleted_at)
CREATE UNIQUE INDEX IF NOT EXISTS uq_court_name_per_venue_active
  ON courts (venue_id, name)
  WHERE deleted_at IS NULL;

-- Composite admin list query index
CREATE INDEX IF NOT EXISTS idx_bookings_admin_list
  ON bookings (venue_id, status, booking_date DESC)
  WHERE deleted_at IS NULL;
```

`scripts/migrate-raw.sh`:
```bash
#!/bin/bash
set -e
for f in src/db/migrations/raw/*.sql; do
  echo "Applying $f"
  psql "$DATABASE_MIGRATION_URL" -f "$f"
done
```

`npm run db:migrate:raw` calls this script.

**AC:** Migration runs without error. `\d bookings` shows `booking_range` column with `GENERATED ALWAYS`. `\d bookings` shows `no_overlapping_approved_bookings` exclusion constraint. Direct SQL test: inserting two approved bookings for same court/time raises error code `23P01`.  
**UT:** `tests/unit/db/exclusion-constraint.test.ts` — direct insert test via testcontainer.

---

#### M0-T06 — Database Seed Script
**Objective:** Create the seed script that inserts the minimum required data for the application to start.  
**Dependencies:** M0-T04  
**Files:** `src/db/seed.ts`

**Implementation requirements:**
- Creates one venue row (The Field, slug: `the-field`, prefix: `TF`, timezone: `Africa/Cairo`).
- Creates three admin roles: `super_admin`, `admin`, `viewer`.
- Creates all permission rows per role (from Section 7.3).
- Creates one super-admin user from `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` env vars. Throws if either is unset.
- Sets `must_change_password = true` on the seeded admin.
- Does NOT create operating hours, courts, pricing rules, or CMS content.
- Is idempotent: running twice does not create duplicates (uses `ON CONFLICT DO NOTHING`).

**AC:** `npm run db:seed` completes without error. Admin can log in with seed credentials. Admin is prompted to change password on first access.

---

#### M0-T07 — Environment Configuration and Validation
**Objective:** Implement `src/lib/config.ts` that reads all required environment variables and throws at startup if any required var is missing.  
**Dependencies:** M0-T02  
**Files:** `src/lib/config.ts`, `.env.example`

**Implementation requirements:**
- Validate at module load time (throws before server starts, not on first request):
  - `VENUE_ID` (required — set after seed)
  - `SESSION_SECRET` (required — min 32 chars)
  - `DATABASE_URL` (required)
  - `STORAGE_PROVIDER` (required: `'s3'` or `'local'`)
  - `BOOKING_EXPIRY_MINUTES` (required — fail with message: "BOOKING_EXPIRY_MINUTES is not set. This is OBD-002 — confirm the value with the venue owner before deploying.")
- Exports `venueConfig` object consumed by all service modules.
- `.env.example` documents every variable with description and OBD references where applicable.

**AC:** Starting the server with a missing required env var prints a clear error and exits. Starting with all vars set succeeds.

---

#### M0-T08 — Logger Setup
**Objective:** Configure pino structured logger with field redaction.  
**Dependencies:** M0-T02  
**Files:** `src/lib/logger.ts`

**Implementation requirements:**
- Redact: `req.headers.cookie`, `*.password`, `*.customerPhone`, `*.phone_number`, `*.storageKey`.
- pino-pretty transport in development only.
- `LOG_LEVEL` env var controls level.

**AC:** `logger.info({ customerPhone: '0101234' }, 'test')` outputs `[REDACTED]` for the phone. JSON output in production. Pretty output in development.

---

#### M0-T09 — CI Pipeline Configuration
**Objective:** Create the GitHub Actions CI pipeline that runs on every push and pull request.  
**Dependencies:** M0-T02, M0-T03  
**Files:** `.github/workflows/ci.yml`

**Implementation requirements:**
```yaml
steps:
  - npm ci
  - npx tsc --noEmit
  - npx eslint src --max-warnings 0
  - npm run test:unit -- --run
  - npm run test:integration -- --run   # uses testcontainers
  - npm audit --audit-level=high
  - npx semgrep --config=p/typescript src/ --error
  - gitleaks detect --log-opts="HEAD~1..HEAD" --exit-code 1
  - npm run build
```

**AC:** Pipeline passes on a clean commit. Pipeline fails if: type errors exist, lint errors exist, unit tests fail, high CVEs found, secrets detected, build fails.

---

#### M0-T10 — Pre-Commit Hooks
**Objective:** Configure local pre-commit hooks to catch issues before they reach CI.  
**Dependencies:** M0-T02  
**Files:** `.husky/pre-commit` (or equivalent)

**Implementation requirements:**
```bash
npx tsc --noEmit
npx eslint src --max-warnings 0
gitleaks protect --staged
```

**AC:** Committing a file with a hardcoded AWS key is blocked by gitleaks. Committing a TypeScript error is blocked.

---

#### M0-T11 — Sentry Initialisation
**Objective:** Configure Sentry error tracking and performance monitoring.  
**Dependencies:** M0-T02  
**Files:** `src/instrumentation.ts`, `sentry.client.config.ts`, `sentry.server.config.ts`

**Implementation requirements:**
- Server-side init in `instrumentation.ts` (also where expiry job starts).
- Client-side init in `sentry.client.config.ts`.
- `beforeSend` scrubs `customerPhone`, `password`, `customerName`, `paymentProof` from event data.
- DSN from `SENTRY_DSN` env var. If not set, Sentry is silently disabled (not a startup error).
- Source maps uploaded to Sentry on production build using `SENTRY_AUTH_TOKEN`.

**AC:** Deliberately throwing an error on the test route `GET /api/test-error` appears in Sentry within 60 seconds. Phone numbers do not appear in Sentry event payloads.

---

#### M0-T12 — Docker Compose for Local Development
**Objective:** Provide a `docker-compose.yml` for running PostgreSQL locally without installing it.  
**Dependencies:** M0-T02  
**Files:** `docker-compose.yml`

**Implementation requirements:**
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: thefield
      POSTGRES_USER: app_user
      POSTGRES_PASSWORD: localdev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
volumes:
  postgres_data:
```

**AC:** `docker compose up -d` starts PostgreSQL. `npm run db:migrate` runs successfully against it.

---

### MILESTONE 1 TASKS

---

#### M1-T01 — Database Client and Transaction Helper
**Objective:** Create the Drizzle database client instance and a typed transaction helper.  
**Dependencies:** M0-T04  
**Files:** `src/lib/db/client.ts`, `src/lib/db/transaction.ts`

**Implementation requirements:**
- Pool configuration: max 10 connections, idle timeout 30s, connection timeout 5s.
- `transaction()` helper wraps Drizzle's `db.transaction()` with `isolationLevel: 'serializable'` as the default for booking-related transactions.
- Non-serializable transactions (audit writes, CMS updates) use `isolationLevel: 'read committed'`.

**AC:** All DB queries work. Pool exhaustion logs a clear error.  
**UT:** `tests/unit/lib/db-transaction.test.ts` — verifies rollback on thrown error.

---

#### M1-T02 — Admin Authentication — Session and Password Utilities
**Objective:** Implement `getAdminSession`, `hashPassword`, `verifyPassword`, and `dummyCompare` as specified in Section 6.  
**Dependencies:** M1-T01  
**Files:** `src/lib/auth/session.ts`, `src/lib/auth/password.ts`

**AC:** Session cookie is HttpOnly, Secure (production), SameSite=Lax, Path=/admin. bcrypt cost factor is 12.  
**UT:** `tests/unit/auth/password.test.ts` — hash + verify + length guard (>72 chars throws).  
**UT:** `tests/unit/auth/session-validation.test.ts` — revocation check using `sessions_invalidated_at`.

---

#### M1-T03 — Admin Repository
**Objective:** Implement `adminRepo` with all database operations needed by the auth and admin management flows.  
**Dependencies:** M1-T01  
**Files:** `src/modules/admin/admin.repository.ts`

**Functions required:**
```typescript
findActiveById(id: string): Promise<AdminUser | null>
findByEmail(email: string): Promise<AdminUser | null>
findAll(venueId: string): Promise<AdminUser[]>
create(data: CreateAdminInput): Promise<AdminUser>
update(id: string, data: UpdateAdminInput): Promise<AdminUser>
deactivate(id: string): Promise<void>  // sets is_active=false AND sessions_invalidated_at=NOW()
```

**AC:** All functions return typed results. IDOR: `findActiveById` only returns active (not soft-deleted) users.

---

#### M1-T04 — Admin Login API Route
**Objective:** Implement `POST /api/v1/admin/auth/login` with brute-force protection.  
**Dependencies:** M1-T02, M1-T03  
**Files:** `src/app/api/v1/admin/auth/login/route.ts`

**Implementation requirements:** Exactly as specified in Section 6.2 Login Flow. Constant-time response. `dummyCompare` on unknown email.

**AC:** Login succeeds with correct credentials. Login fails with wrong password (same response time within 50ms of success). Login fails with unknown email (same timing). 6th attempt within 15 min returns 429.  
**IT:** `tests/integration/api/admin/admin-auth.test.ts` — all above cases.  
**IT:** Rate limit test (6 rapid failures → 429).

---

#### M1-T05 — Admin Logout and Me Routes
**Objective:** Implement `POST /api/v1/admin/auth/logout` and `GET /api/v1/admin/auth/me`.  
**Dependencies:** M1-T02  
**Files:** `src/app/api/v1/admin/auth/logout/route.ts`, `src/app/api/v1/admin/auth/me/route.ts`

**AC:** Logout destroys session. Subsequent request to protected route returns 401. `/me` returns admin profile without password hash.

---

#### M1-T06 — Permission Repository and `requirePermission` Helper
**Objective:** Implement `permissionsRepo.getForRole()` and the `requirePermission` service function.  
**Dependencies:** M1-T01  
**Files:** `src/modules/admin/admin.repository.ts` (add), `src/lib/auth/permissions.ts`

**AC:** `requirePermission` throws `ForbiddenError` when permission absent. Resolves when permission present.  
**UT:** `tests/unit/auth/permissions.test.ts` — all cases from Section 12.2.

---

#### M1-T07 — Admin Login Page UI
**Objective:** Build the `/admin/login` page with the login form.  
**Dependencies:** M1-T04  
**Files:** `src/app/admin/login/page.tsx`

**Implementation requirements:**
- Email and password inputs with associated labels (not placeholder-only).
- Submit button disabled during pending request.
- Display generic error message on failure (never "user not found" vs "wrong password").
- Redirect to `/admin/dashboard` on success.

**AC:** Form is keyboard-navigable. Error message appears on wrong credentials. No enumeration of email existence.  
**E2E:** `tests/e2e/admin/admin-login.spec.ts`.

---

#### M1-T08 — Admin Layout with Auth Guard
**Objective:** Build the admin shell layout that guards all `/admin/**` routes.  
**Dependencies:** M1-T07  
**Files:** `src/app/admin/layout.tsx`

**Implementation requirements:**
- Server component: calls `getAdminSession()`, redirects if not authenticated.
- Renders admin sidebar navigation.
- Sidebar navigation items are filtered by the admin's permissions (permission-invisible UI).
- `PendingBookingsBanner` component showing count of actionable bookings.

**AC:** Direct navigation to `/admin/dashboard` without session redirects to `/admin/login`. Sidebar shows only permitted navigation items.  
**E2E:** `tests/e2e/security/unauthorized-access.spec.ts`.

---

#### M1-T09 — Admin Dashboard Skeleton Page
**Objective:** Build the `/admin/dashboard` page with summary cards.  
**Dependencies:** M1-T08  
**Files:** `src/app/admin/dashboard/page.tsx`

**Implementation requirements:**
- Today's confirmed bookings count.
- Pending requests count (payment_submitted + under_review).
- Payments awaiting verification count.
- All queries scoped to `venueConfig.id`.
- Empty state: shows "No bookings today" rather than 0 raw number with no context.

**AC:** Dashboard loads without error. All counts are accurate.

---

#### M1-T10 — Security Headers Middleware
**Objective:** Implement `src/app/middleware.ts` with all security headers.  
**Dependencies:** M0-T02  
**Files:** `src/app/middleware.ts`

**AC:** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, HSTS, CSP with nonce, all present on every response. securityheaders.com scan shows grade B or above.

---

#### M1-T11 — Rate Limiter Utilities
**Objective:** Implement all `rate-limiter-flexible` instances as specified in Section 5.6.  
**Dependencies:** M0-T02  
**Files:** `src/lib/rate-limiter.ts`

**AC:** Each limiter configured with correct points and duration. IP extraction uses `X-Real-IP` header (set by NGINX).

---

#### M1-T12 — `must_change_password` Enforcement Route
**Objective:** Implement the `/admin/change-password` page and enforce the redirect in admin layout.  
**Dependencies:** M1-T08  
**Files:** `src/app/admin/change-password/page.tsx`, update `src/app/admin/layout.tsx`

**Implementation requirements:**
- Form: current password, new password, confirm new password.
- Server action validates: current password correct, new password ≠ current, min 8 chars, ≤ 72 chars.
- On success: updates `password_hash`, sets `must_change_password = false`, audit logs `admin_updated`.

**AC:** Admin seeded with `must_change_password = true` cannot access any admin page except `/admin/change-password`. After changing password, full dashboard access is granted.

---

#### M1-T13 — Audit Service
**Objective:** Implement the append-only audit log writer.  
**Dependencies:** M1-T01  
**Files:** `src/modules/audit/audit.service.ts`, `src/modules/audit/audit.repository.ts`

**Functions required:**
```typescript
log(entry: AuditEntry): Promise<void>
logTx(tx: DrizzleTransaction, entry: AuditEntry): Promise<void>  // for use inside transactions
```

**AC:** Audit log entries are created correctly. `app_user` cannot UPDATE or DELETE audit_log rows (verified by attempting via app DB connection).  
**UT:** Verify `logTx` creates the entry within the same transaction.

---

#### M1-T14 — Milestone 1 Integration Tests
**Objective:** Write all integration tests for authentication and authorization.  
**Dependencies:** M1-T01 through M1-T13  
**Files:** `tests/integration/api/admin/admin-auth.test.ts`

**Tests:** All cases listed in Section 12.3 Admin Approval section, plus:
- Session revocation: deactivate admin mid-session, next API call returns 401.
- `must_change_password` redirect enforcement.
- Permission escalation prevention (cannot assign role with more permissions than own).

---

### MILESTONE 2 TASKS

---

#### M2-T01 — Storage Service Interface and Implementations
**Objective:** Build `StorageService` interface, S3/R2 implementation, and local disk fallback.  
**Dependencies:** M0-T07  
**Files:** `src/modules/storage/storage.service.ts`, `src/modules/storage/storage.s3.ts`, `src/modules/storage/storage.local.ts`

**AC:** `storageService.put()` uploads a file. `storageService.getSignedUrl()` returns a URL expiring in specified seconds. `storageService.getPublicUrl()` returns the CDN URL. Switching between `s3` and `local` via env var works without code changes.

---

#### M2-T02 — CMS Repository and Service
**Objective:** Implement all CMS database operations and service functions.  
**Dependencies:** M1-T01  
**Files:** `src/modules/cms/cms.repository.ts`, `src/modules/cms/cms.service.ts`, `src/modules/cms/cms.validators.ts`

**AC:** All functions from Section 10.3 implemented. `updateSetting` calls `revalidateTag`. IDOR check on all write operations. HTML sanitisation applied to markdown fields.  
**UT:** `tests/unit/modules/cms/cms-validators.test.ts` — InstaPay number format, URL validation, text length limits.

---

#### M2-T03 — CMS Admin API Routes
**Objective:** Implement all `/api/v1/admin/cms/*` routes.  
**Dependencies:** M2-T02  
**Files:** `src/app/api/v1/admin/cms/*/route.ts`

**AC:** Every route requires `manage_cms` permission. Every write is audited. IDOR check passes venue scope.  
**IT:** `tests/integration/api/admin/cms-management.test.ts`.

---

#### M2-T04 — Public Layout, Navigation, and Tailwind Theme
**Objective:** Create the public site layout, navigation, and The Field brand theme in Tailwind.  
**Dependencies:** M0-T02  
**Files:** `src/app/(public)/layout.tsx`, `tailwind.config.ts`, `src/components/ui/`

**Implementation requirements:**
- WhatsApp contact button: reads `venue.whatsapp` from CMS. If not configured, button is hidden (not shown as a broken link).
- Navigation links: Home, Courts, Pricing, Book Now, Gallery, FAQs, Contact.
- "Book Now" is a prominent CTA button in the nav.
- Mobile-first: hamburger menu on small screens.
- HTML `lang` attribute set to a value controlled by an env var `NEXT_PUBLIC_LOCALE` (default `en`). This allows future language switching without code changes.
- Font stack includes Arabic-compatible fonts (e.g., system-ui or a font that supports both scripts) even if Arabic is not used in V1.

**AC:** Nav renders on mobile (390px) without horizontal scroll. WhatsApp button hidden when number not configured.

---

#### M2-T05 — Home Page
**Objective:** Build the public home page with all CMS-driven sections.  
**Dependencies:** M2-T02, M2-T04  
**Files:** `src/app/(public)/page.tsx`

**Implementation requirements:**
- Hero section: headline, subtitle, CTA button — all from CMS. Fallback text if CMS is empty.
- About section: from CMS `about.*` settings.
- Courts preview: from `courts` table (active courts only).
- Announcements banner: from `cms_announcements` (published, not expired). Hidden if none.
- Gallery preview: from `cms_gallery_items` (published). Hidden if none.
- Full page RSC — no client-side fetching.
- Cache tags: `['cms-{venueId}', 'courts-{venueId}']`.

**AC:** Page renders without error when all CMS content is absent. Correct content shown when populated. Lighthouse mobile ≥ 80 (target ≥ 85 at Milestone 6).

---

#### M2-T06 — About, Pricing, Gallery, FAQ, Contact Pages
**Objective:** Build all remaining static/CMS-driven public pages.  
**Dependencies:** M2-T02, M2-T04  
**Files:** `src/app/(public)/about/`, `pricing/`, `gallery/`, `faq/`, `contact/`

**Implementation requirements:**
- About: renders CMS body with sanitised HTML. Shows operating hours from `operating_hours` table. If no hours configured: "Operating hours coming soon."
- Pricing: reads `court_pricing_rules` for all active courts. If no rules: "Pricing coming soon."
- Gallery: grid of published `cms_gallery_items`. Lightbox on click. If empty: "Gallery coming soon."
- FAQ: accordion of published `cms_faqs`. If empty: section not rendered.
- Contact: phone, email, address, map embed, social links — all from CMS. Map embed URL in sandboxed `<iframe sandbox="allow-scripts allow-same-origin">`.

**AC:** All pages render without error when CMS content is absent. Content appears when populated.

---

#### M2-T07 — Courts Page
**Objective:** Build the public courts listing page.  
**Dependencies:** M2-T04  
**Files:** `src/app/(public)/courts/page.tsx`

**Implementation requirements:**
- Lists active courts from `courts` table, ordered by `display_order`.
- Each court card: name, description, features, court photos.
- "Book Now" button links to `/book?courtId={id}`.
- If no active courts: "Courts coming soon."

**AC:** Court with `is_active = false` does not appear. Court created in admin immediately appears (no static generation — page uses `revalidate: 0` or `dynamic = 'force-dynamic'` or `revalidateTag`).

---

#### M2-T08 — Admin CMS Settings Editor
**Objective:** Build the `/admin/cms/settings` page with grouped settings tabs.  
**Dependencies:** M2-T03  
**Files:** `src/app/admin/cms/settings/page.tsx`

**Implementation requirements:**
- Tab groups: General, Contact, Payment, Homepage, About, SEO.
- Each tab renders a form with labeled fields (type-appropriate inputs per `value_type`).
- Payment tab prominently shows: "InstaPay Number — this is shown to customers during checkout. OBD-002 PENDING — confirm with venue owner before setting."
- On save: `PUT /api/v1/admin/cms/settings` — all fields in the tab group.
- Success toast on save. Error toast on failure.

**AC:** Admin can update venue name and see change on public homepage after refreshing. InstaPay number change reflected on booking checkout screen.  
**E2E:** `tests/e2e/admin/cms-editing.spec.ts`.

---

#### M2-T09 — Admin CMS Collections Editors (FAQs, Gallery, Events, Announcements, Social)
**Objective:** Build all remaining admin CMS editors.  
**Dependencies:** M2-T03  
**Files:** `src/app/admin/cms/faqs/`, `gallery/`, `events/`, `announcements/`, `social/`

**Implementation requirements:**
- FAQs: table with drag-to-reorder, inline edit modal, publish/unpublish toggle.
- Gallery: grid view, upload (drag-and-drop), caption edit, delete.
- Events: list with upcoming/past tabs, create/edit form, cover image upload.
- Announcements: list with active/expired tabs, expiry date picker.
- Social: list of predefined platforms (Instagram, Facebook, TikTok, YouTube, Twitter/X), URL input per platform, active toggle.

**AC:** Admin can add an FAQ and see it on the public FAQ page. Admin can upload a gallery image and see it in the public gallery.

---

#### M2-T10 — Booking Status Page (Authenticated)
**Objective:** Build the `/booking-status` page for customers to check their booking.  
**Dependencies:** M1-T01  
**Files:** `src/app/(public)/booking-status/page.tsx`, `src/app/api/v1/booking-status/route.ts`

**Implementation requirements:**
- Requires a customer session; otherwise redirect to sign-in.
- `POST /api/v1/booking-status`: rate-limited (10/10min), scoped to the session account, and returns friendly status data only.
- Response shows: status label, court name, date, time, price, payment status.
- If booking is `pending`: shows "Upload Payment Proof" section.
- If booking is `rejected`: shows rejection reason.
- No internal IDs, no admin notes, no phone number re-displayed.

**AC:** An account owner can view their booking. A different account receives "not found". An unauthenticated request receives 401. Rate limiting: 11th attempt returns 429.  
**IT:** `tests/integration/api/bookings/booking-status-lookup.test.ts`.  
**E2E:** `tests/e2e/customer/booking-status-lookup.spec.ts`.

---

#### M2-T11 — Milestone 2 Accessibility and Performance Audit
**Objective:** Run axe-core and Lighthouse against all public pages and fix all critical violations.  
**Dependencies:** M2-T05 through M2-T10  
**Files:** `tests/e2e/accessibility/public-pages.spec.ts`

**AC:** axe-core: 0 critical violations. Lighthouse mobile performance ≥ 80 on home and courts pages. All images have alt text. All form inputs have labels. Keyboard navigation works through booking flow.

---

### MILESTONE 3 TASKS

---

#### M3-T01 — Venue Service
**Objective:** Implement venue service functions needed by the booking engine.  
**Dependencies:** M1-T01  
**Files:** `src/modules/venue/venue.service.ts`, `src/modules/venue/venue.repository.ts`

**Functions:**
```typescript
getOperatingHoursForDay(venueId, dayOfWeek): Promise<OperatingHours | null>
isDateBlocked(venueId, date): Promise<boolean>
getBlockedPeriodsForCourtAndDate(venueId, courtId, date): Promise<BlockedPeriod[]>
assertDateIsOperational(venueId, date): Promise<void>  // throws if blocked or closed
assertSlotIsWithinHours(venueId, date, startTime, endTime): Promise<void>
```

**UT:** `tests/unit/modules/venue/venue-schedule.test.ts`.

---

#### M3-T02 — Courts Service and Repository
**Objective:** Implement court service functions.  
**Dependencies:** M1-T01  
**Files:** `src/modules/courts/courts.service.ts`, `src/modules/courts/courts.repository.ts`

**Functions:** `getActiveCourts`, `getCourtByIdAndVenueId`, `assertCourtActive`, `getMaintenanceForCourtAndDate`.

**AC:** Returns only active courts for the venue. Inactive/deleted courts not returned.

---

#### M3-T03 — Pricing Calculator (Pure Function)
**Objective:** Implement the price calculation pure function.  
**Dependencies:** None (pure function)  
**Files:** `src/modules/pricing/pricing.calculator.ts`

**Implementation requirements:**
- Takes: `rules: PricingRule[]`, `date: Date`, `startTime: string` (HH:MM).
- Returns: `priceAmount: number`.
- Throws `NoPricingConfiguredError` if no rules match.
- Day-of-week must be calculated using Africa/Cairo timezone.
- Priority: higher `priority` number wins. Equal priority: first match wins.

**UT:** All cases from Section 12.2. 100% branch coverage required.

---

#### M3-T04 — Slot Generator (Pure Function)
**Objective:** Implement the hour-slot generator.  
**Dependencies:** None  
**Files:** `src/modules/availability/slot.generator.ts`

**Implementation requirements:**
- Takes `openTime: string`, `closeTime: string` (HH:MM).
- Returns array of `{ startTime, endTime }` for each 1-hour aligned slot.
- `00:00` is treated as midnight (23:00–00:00 is the final slot if venue closes at midnight, expressed as `close_time = '24:00'` or handled by convention).
- Returns empty array if no hours configured.

**UT:** All cases from Section 12.2.

---

#### M3-T05 — Conflict Detector (Pure Function)
**Objective:** Implement time-overlap detection.  
**Dependencies:** None  
**Files:** `src/modules/availability/conflict.detector.ts`

**Implementation requirements:**
- `hasTimeOverlap(aStart, aEnd, bStart, bEnd): boolean`
- Adjacent slots (aEnd === bStart) return `false` — not overlapping.

**UT:** All cases from Section 12.2. 100% branch coverage required.

---

#### M3-T06 — Availability Service and API Route
**Objective:** Implement the full availability calculation and `GET /api/v1/availability` route.  
**Dependencies:** M3-T01 through M3-T05  
**Files:** `src/modules/availability/availability.service.ts`, `src/app/api/v1/availability/route.ts`

**AC:** Correct slots returned for a date with operating hours. Slots blocked by existing bookings show `available: false, reason: 'booked'`. Slots blocked by maintenance show `reason: 'maintenance'`. Returns empty array on blocked date. Returns 503 "not configured" when operating hours table empty. Never cached — always fresh.  
**IT:** `tests/integration/api/availability/availability.test.ts` — all slot scenarios.

---

#### M3-T07 — Booking Reference Generator
**Objective:** Implement booking reference generator as specified in Section 8.7.  
**Dependencies:** M1-T01 (reads venue for prefix)  
**Files:** `src/modules/bookings/booking.reference.ts`

**AC:** Prefix sourced from `venues.booking_ref_prefix`. Format matches `TF-YYYYMMDD-XXXX`. Safe characters only (no 0, O, I, 1).  
**UT:** All cases from Section 12.2.

---

#### M3-T08 — Booking State Machine
**Objective:** Implement the state machine as specified in Section 8.5.  
**Dependencies:** None (pure logic)  
**Files:** `src/modules/bookings/booking.state-machine.ts`

**AC:** All allowed transitions pass. All forbidden transitions throw `BookingTransitionForbiddenError`. Terminal states (rejected, cancelled, expired) throw on any further transition.  
**UT:** 100% branch coverage — all cases from Section 12.2.

---

#### M3-T09 — Bookings Repository
**Objective:** All database operations for bookings.  
**Dependencies:** M1-T01  
**Files:** `src/modules/bookings/bookings.repository.ts`

**Key functions:**
```typescript
findByIdAndVenueId(id, venueId)         // IDOR-safe lookup
findByReferenceAndPhone(ref, phone)     // customer identity check
findActiveOnDate(courtId, date)         // for availability
countByStatuses(statuses, venueId)      // dashboard counts
findPaginated(filters, venueId)         // admin list with filters
```

---

#### M3-T10 — Customer Accounts Repository
**Objective:** Customer-account lookup and profile update for authenticated customers.  
**Dependencies:** M1-T01  
**Files:** `src/modules/customers/customers.repository.ts`

**Key function:**
```typescript
findById(accountId): Promise<CustomerAccount | null>
updateProfile(accountId, profile): Promise<CustomerAccount>
// Account creation occurs only in Google or email/password authentication flows.
```

---

#### M3-T11 — Booking Creation Service
**Objective:** Implement `bookingsService.createBooking()` as specified in Section 8.2.  
**Dependencies:** M3-T01 through M3-T10  
**Files:** `src/modules/bookings/bookings.service.ts`

**Implementation requirements:**
- Full validation sequence (steps 1–9 from Section 8.2).
- Transaction uses `isolationLevel: 'serializable'`.
- `SELECT ... FOR UPDATE` inside transaction before INSERT.
- File upload is non-blocking: booking INSERT always commits before file upload is attempted.

**AC:** All validation rules enforced. Price is server-calculated and stored immutably. Booking reference sourced from venue prefix.  
**UT:** N/A (integration tested).  
**IT:** All cases from `tests/integration/api/bookings/create-booking.test.ts`.

---

#### M3-T12 — Booking Creation API Route
**Objective:** Implement `POST /api/v1/bookings`.  
**Dependencies:** M3-T11  
**Files:** `src/app/api/v1/bookings/route.ts`

**AC:** Returns 201 with booking reference. No price field in request schema. Rate limited.  
**IT:** `tests/integration/api/bookings/create-booking.test.ts`.

---

#### M3-T13 — Booking Expiry Job
**Objective:** Implement the node-cron expiry job as specified in Section 8.3.  
**Dependencies:** M3-T11, M1-T13  
**Files:** `src/jobs/expire-bookings.ts`, update `src/instrumentation.ts`

**AC:** Only `pending` bookings with `expires_at < NOW()` are expired. `payment_submitted` bookings are NOT expired. Audit log entry created per expired booking. Sentry heartbeat sent after each run.  
**IT:** `tests/integration/database/expiry-job.test.ts`.

---

#### M3-T14 — Booking Flow UI — Court Selection
**Objective:** Build booking step 1: court selection.  
**Dependencies:** M2-T07  
**Files:** `src/app/(public)/book/page.tsx`

**AC:** Active courts shown with name, features, and price range. "Book Now" from courts page pre-selects the court. Inactive courts not shown.

---

#### M3-T15 — Booking Flow UI — Date Picker
**Objective:** Build booking step 2: date selection with disabled blocked/closed dates.  
**Dependencies:** M3-T06  
**Files:** `src/app/(public)/book/page.tsx` (continued)

**Implementation requirements:**
- Fetches blocked dates and open days from the server to disable unavailable dates.
- Dates before today are disabled.
- If operating hours not configured, all dates disabled with message.

**AC:** Blocked date is unselectable. Past dates are unselectable. Only open days of the week are selectable.

---

#### M3-T16 — Booking Flow UI — Time Slot Grid
**Objective:** Build booking step 3: time slot selection.  
**Dependencies:** M3-T06  
**Files:** `src/app/(public)/book/page.tsx` (continued)

**Implementation requirements:**
- Fetches `GET /api/v1/availability?courtId=&date=` on court + date selection.
- Available slots shown as selectable buttons with price.
- Unavailable slots shown as greyed-out with reason label ("Booked", "Maintenance", "Blocked").
- Price displayed for each available slot from the availability response.

**AC:** Approved booking slot shown as "Booked." Maintenance slot shown as "Maintenance." Adjacent slots bookable. Different court same time bookable.

---

#### M3-T17 — Booking Flow UI — Customer Form and Submission
**Objective:** Build booking step 4: customer info + payment instructions + submission.  
**Dependencies:** M3-T12  
**Files:** `src/app/(public)/book/page.tsx` (continued)

**Implementation requirements:**
- Customer name + phone (Egyptian format validation client-side, validated again server-side).
- InstaPay instructions loaded from CMS. If `venue.instapay_number` is empty: show warning "Payment instructions not yet configured. Please contact the venue." and disable submission.
- Proof upload: optional at this step. Clear message: "You can also upload proof later."
- Submit: `POST /api/v1/bookings` (multipart).
- On success: show confirmation screen with reference.
- On conflict (409): "This slot was just taken by someone else. Please select another time."
- On rate limit (429): "You've submitted too many requests. Please wait before trying again."

**AC:** Submission without proof creates `pending` booking. Submission with proof creates `payment_submitted` booking. Both show correct status on confirmation screen. CTA to go to booking status page.  
**E2E:** `tests/e2e/customer/full-booking-flow.spec.ts`.

---

#### M3-T18 — Booking Flow UI — Confirmation Screen
**Objective:** Build the booking confirmation screen shown after successful submission.  
**Dependencies:** M3-T17  
**Files:** `src/app/(public)/book/confirmation/page.tsx` (or inline in book flow)

**Implementation requirements:**
- Shows: booking reference (large, prominent), court, date, time, price, status.
- "Save Reference" reminder.
- Link to booking status page.
- Booking reference format prominently displayed.

**AC:** Reference is visible and matches `TF-YYYYMMDD-XXXX` format.

---

#### M3-T19 — Courts Public API Route
**Objective:** Implement `GET /api/v1/courts` and `GET /api/v1/courts/[id]`.  
**Dependencies:** M3-T02  
**Files:** `src/app/api/v1/courts/route.ts`, `src/app/api/v1/courts/[id]/route.ts`

**AC:** Only active courts returned. Scoped to venue. No internal IDs exposed beyond court UUID (needed for booking submission).

---

#### M3-T20 — Double-Booking Integration Tests
**Objective:** Write and run all double-booking protection tests.  
**Dependencies:** M3-T11  
**Files:** `tests/integration/database/booking-integrity.test.ts`

**AC:** All 10 test cases from Section 12.3 pass, including the concurrent 10-request test.

---

#### M3-T21 — Price Manipulation Integration Test
**Objective:** Verify server-calculated price cannot be overridden.  
**Dependencies:** M3-T12  
**Files:** `tests/integration/api/bookings/price-manipulation.test.ts`

**AC:** All 4 cases from Section 12.3 pass.

---

#### M3-T22 — Milestone 3 E2E Tests
**Objective:** Run full booking flow E2E tests.  
**Dependencies:** M3-T17, M3-T18  
**Files:** `tests/e2e/customer/full-booking-flow.spec.ts`, `tests/e2e/customer/availability-display.spec.ts`

**AC:** Full booking flow passes on 390px viewport. Availability correctly shows booked/blocked slots.

---

### MILESTONE 4 TASKS

---

#### M4-T01 — Payment Records Repository
**Objective:** All database operations for `payment_records` and `payment_proofs`.  
**Dependencies:** M1-T01  
**Files:** `src/modules/payments/payments.repository.ts`

**Functions:** `createRecord`, `updateStatus`, `findByBookingId`, `createProof`, `findProofsByPaymentId`, `findProofById`.

---

#### M4-T02 — File Validation Utility
**Objective:** Implement `validateProofFile` and `validateGalleryImage` as specified in Section 9.4.  
**Dependencies:** None  
**Files:** `src/lib/validation/file.ts`

**UT:** All cases from Section 12.2 — especially PHP disguised as JPEG, SVG rejection, size limit.

---

#### M4-T03 — Proof Upload Service
**Objective:** Implement the complete proof upload pipeline as specified in Section 9.1.  
**Dependencies:** M4-T01, M4-T02, M2-T01  
**Files:** `src/modules/payments/payments.service.ts`

**AC:** Non-blocking: booking INSERT always commits before upload. Upload failure leaves booking in `pending`. Upload success updates to `payment_submitted`. Audit log not created for file upload (proof viewed is audited separately).

---

#### M4-T04 — Proof Upload API Routes (Public + Admin View)
**Objective:** Implement `POST /api/v1/bookings/proof` and `GET /api/v1/admin/bookings/[id]/proofs/[proofId]/view`.  
**Dependencies:** M4-T03  
**Files:** `src/app/api/v1/bookings/proof/route.ts`, `src/app/api/v1/admin/bookings/[id]/proofs/[proofId]/view/route.ts`

**AC:** Customer upload: all validation rules enforced. Admin view: session + `view_payment_proof` required. Redirects to 5-min signed URL. Access logged.  
**IT:** `tests/integration/api/bookings/proof-upload.test.ts` — all cases from Section 12.3.

---

#### M4-T05 — Booking Approval Service
**Objective:** Implement `bookingsService.approveBooking()` with the full serializable transaction specified in Section 8.4.  
**Dependencies:** M3-T08, M4-T01, M1-T13  
**Files:** `src/modules/bookings/bookings.service.ts` (update)

**AC:** Approval re-checks availability inside transaction. `expires_at` cleared on approval. PostgreSQL `23P01` error caught and mapped to HTTP 409. Two audit entries created.  
**IT:** `tests/integration/api/admin/approve-booking.test.ts`.

---

#### M4-T06 — Booking Rejection and Cancellation Services
**Objective:** Implement `rejectBooking` and `cancelBooking`.  
**Dependencies:** M3-T08, M1-T13  
**Files:** `src/modules/bookings/bookings.service.ts` (update)

**AC:** Rejection requires reason. Slot released immediately. Audit logged.  
**IT:** `tests/integration/api/admin/reject-booking.test.ts`.

---

#### M4-T07 — Admin Booking Management API Routes
**Objective:** Implement all admin booking API routes from Section 5.4.  
**Dependencies:** M4-T05, M4-T06  
**Files:** `src/app/api/v1/admin/bookings/*/route.ts`

**AC:** All routes require auth + correct permission. IDOR check on every route.

---

#### M4-T08 — Admin Booking List Page
**Objective:** Build the `/admin/bookings` page.  
**Dependencies:** M4-T07  
**Files:** `src/app/admin/bookings/page.tsx`

**AC:** Default filter shows payment_submitted + under_review. Pagination works. Quick Approve/Reject buttons visible per permissions. Search by name/phone/reference works.

---

#### M4-T09 — Admin Booking Detail Page
**Objective:** Build the `/admin/bookings/[id]` page.  
**Dependencies:** M4-T07  
**Files:** `src/app/admin/bookings/[id]/page.tsx`

**AC:** All 6 sections from Section 11.4 rendered. View Proof button triggers signed URL redirect. Action buttons shown per status and permission. Confirmation dialog on destructive actions.

---

#### M4-T10 — Admin Approve/Reject UI Flow
**Objective:** Implement the approve and reject UI workflows.  
**Dependencies:** M4-T09  
**Files:** `src/app/admin/bookings/[id]/page.tsx` (actions), `src/components/admin/booking/`

**AC:** Approve shows confirmation modal. Reject shows reason dialog with predefined + custom options. Conflict error displays conflicting booking reference. Success/error toasts on every action.  
**E2E:** `tests/e2e/admin/approve-booking.spec.ts`, `tests/e2e/admin/reject-booking.spec.ts`.

---

#### M4-T11 — Late Proof Upload UI (Booking Status Page)
**Objective:** Add the proof upload section to the booking status page for pending bookings.  
**Dependencies:** M4-T04, M2-T10  
**Files:** `src/app/(public)/booking-status/page.tsx` (update)

**AC:** Upload section visible when `canUploadProof = true`. Upload succeeds and status updates to `payment_submitted`. Rate limited.  
**E2E:** `tests/e2e/customer/late-proof-upload.spec.ts`.

---

#### M4-T12 — Payment Proof Security Tests
**Objective:** Run all proof security integration tests.  
**Dependencies:** M4-T04  
**Files:** `tests/integration/api/bookings/proof-upload.test.ts`

**AC:** All cases from Section 12.3 pass, including PHP file disguised as JPEG.

---

#### M4-T13 — Concurrent Approval Integration Test
**Objective:** Verify two admins cannot approve conflicting bookings simultaneously.  
**Dependencies:** M4-T05  
**Files:** `tests/integration/database/booking-integrity.test.ts` (update)

**AC:** "TWO ADMINS" test case from Section 12.3 passes.

---

#### M4-T14 — Payment Proof Access Control Test
**Objective:** Verify proof files are not publicly accessible.  
**Dependencies:** M4-T04  
**Files:** `tests/integration/api/security/proof-access-control.test.ts`

**AC:** Direct R2 URL without signed token returns 403. Signed URL works within 5 minutes. Expired signed URL returns 403.

---

### MILESTONE 5 TASKS

---

#### M5-T01 — Admin Court Management (API + UI)
**Objective:** Full court CRUD in admin.  
**Dependencies:** M3-T02  
**Files:** `src/app/api/v1/admin/courts/*/route.ts`, `src/app/admin/courts/`

**AC:** Add court with name uniqueness enforced. Disable court without affecting existing bookings. Court photo upload works. New court immediately appears in public booking flow.  
**E2E:** `tests/e2e/admin/court-management.spec.ts`.

---

#### M5-T02 — Admin Pricing Management (API + UI)
**Objective:** Full pricing rule CRUD.  
**Dependencies:** M3-T03  
**Files:** `src/app/api/v1/admin/pricing/*/route.ts`, `src/app/admin/pricing/page.tsx`

**AC:** Pricing rules create/edit/delete work. Soft delete does not alter existing booking prices. Tooltip warns admin prices only affect future bookings.

---

#### M5-T03 — Admin Schedule Management (API + UI)
**Objective:** Operating hours, blocked dates, blocked periods, maintenance periods.  
**Dependencies:** M3-T01  
**Files:** `src/app/api/v1/admin/schedule/*/route.ts`, `src/app/admin/schedule/`

**AC:** Operating hours change immediately affects public availability. Blocked date appears as unavailable in booking date picker. Maintenance period blocks court slots. Warning shown when confirmed bookings exist in a maintenance window.

---

#### M5-T04 — Admin Customer Management (API + UI)
**Objective:** Customer search and booking history.  
**Dependencies:** M1-T01  
**Files:** `src/app/api/v1/admin/customers/*/route.ts`, `src/app/admin/customers/`

**AC:** Search by name and phone works. Customer detail shows all associated bookings. Admin can add internal notes.

---

#### M5-T05 — Admin Administrator Management (API + UI)
**Objective:** Full admin CRUD: create, edit, deactivate, activate.  
**Dependencies:** M1-T02, M1-T06  
**Files:** `src/app/api/v1/admin/administrators/*/route.ts`, `src/app/admin/administrators/`

**AC:** Only super_admin can access this section. New admin must change password on first login. Deactivation takes immediate effect (session revocation). Last super_admin cannot be deactivated.

---

#### M5-T06 — Admin Audit Log Viewer (API + UI)
**Objective:** Paginated, filterable audit log viewer.  
**Dependencies:** M1-T13  
**Files:** `src/app/api/v1/admin/audit-logs/route.ts`, `src/app/admin/audit-logs/page.tsx`

**AC:** Only `view_audit_logs` permission can access. No edit/delete controls. Filters by admin, action, entity type, date range work. Old/new value diff visible on row expansion.

---

#### M5-T07 through M5-T10 — Admin System Settings, Roles, Dashboard Polish, Mobile Admin
**Objective:** System settings page, role/permission viewer, dashboard polish, mobile responsiveness.  
**AC:** Admin can manage system settings. Role permissions are viewable. Dashboard loads in < 1s. Admin pages usable on tablet (768px).

---

#### M5-T11 through M5-T16 — Milestone 5 Integration and E2E Tests
**Objective:** Write and run all Milestone 5 tests.  
**Files:** `tests/integration/api/admin/`, `tests/e2e/admin/`

**AC:** All admin workflow E2E tests from Section 12.4 pass.

---

### MILESTONE 6 TASKS

---

#### M6-T01 — OWASP ZAP Baseline Scan on Staging
**AC:** 0 high/critical findings. All medium findings reviewed and documented.

#### M6-T02 — Burp Suite Manual Testing
**Scope:** Booking flow, admin approval, file upload, IDOR attempts, rate limits.  
**AC:** No critical vulnerabilities found.

#### M6-T03 — Semgrep Security Scan
**AC:** 0 high findings in CI. All findings addressed.

#### M6-T04 — gitleaks Full History Scan
**AC:** No secrets in git history. If found: rotate immediately before proceeding.

#### M6-T05 — Lighthouse Audit — Target ≥ 85 Mobile
**AC:** Home page ≥ 85. Booking page ≥ 85. Fix largest issues before production.

#### M6-T06 — Full E2E Test Suite Run on Staging
**AC:** All E2E tests pass on staging environment against real staging database.

#### M6-T07 — Backup and Restore Verification
**AC:** Run `backup-db.sh`. Restore the backup to a test database. Verify data integrity. Document procedure.

#### M6-T08 — PM2 Startup Verification
**AC:** Reboot the staging VPS. Verify application starts automatically within 60 seconds. UptimeRobot shows "up" after reboot.

#### M6-T09 — UptimeRobot and Sentry Verification
**AC:** UptimeRobot alerts fire within 5 minutes of stopping the server. Sentry receives a test exception and shows it within 60 seconds.

#### M6-T10 — Privacy Policy Page
**AC:** `/privacy` page exists and displays privacy policy text.

#### M6-T11 — TLS and HSTS Verification
**AC:** `https://thefield.eg` serves over TLS 1.3. HTTP redirects to HTTPS. HSTS header with preload present.

#### M6-T12 — securityheaders.com Scan
**AC:** Grade B or above. Address all findings below B.

#### M6-T13 — Load Test (100 Concurrent Users)
**Tool:** k6 or Artillery.  
**AC:** 100 concurrent users sending availability + booking requests. p95 availability response < 500ms. p95 booking creation < 1000ms. 0 5xx errors.

#### M6-T14 — OBD-001 Through OBD-005 Final Status Check
**AC:** All 5 open business decisions have a confirmed status (resolved or explicitly accepted as pending with documented owner sign-off). No unresolved OBD blocks launch.

#### M6-T15 — Seed Credential Rotation
**AC:** Initial `SEED_ADMIN_PASSWORD` changed. `must_change_password` confirmed false for all active admins.

#### M6-T16 — README and Operations Documentation
**AC:** README covers: local setup, env vars, migrations, seeding, deployment, backup/restore, and troubleshooting. Admin onboarding guide covers: approve a booking, change pricing, block a date, update InstaPay number.

#### M6-T17 — Production Deployment
**AC:** Application deployed to production. `pm2 status` shows running. Health endpoint returns 200.

#### M6-T18 — Post-Deployment Smoke Test
**AC:** Manual end-to-end: create booking → upload proof → admin approves → check status. Confirm the full loop works in production.

#### M6-T19 — Venue Owner Acceptance Test
**AC:** A non-technical administrator (venue owner or designee) completes without developer assistance: change InstaPay number, add FAQ, block a date, update operating hours. All changes reflected on the public site.

#### M6-T20 — npm audit Final Check
**AC:** `npm audit --audit-level=high` passes with 0 high/critical vulnerabilities.

---

## Section 18: Quality Gates

### Gate 0 — After Milestone 0
- [ ] `npm run dev` starts without error
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes with 0 warnings
- [ ] `npm run db:migrate && npm run db:migrate:raw` completes without error
- [ ] `npm run db:seed` completes without error
- [ ] `btree_gist` extension confirmed installed
- [ ] Exclusion constraint verified: direct SQL INSERT test raises error code `23P01`
- [ ] CI pipeline passes on an empty commit
- [ ] No secrets in git history (`gitleaks detect` passes)

### Gate 1 — After Milestone 1
- [ ] All Gate 0 checks still pass
- [ ] Admin can log in with seed credentials
- [ ] Admin is redirected to change-password on first login
- [ ] Session revocation works (deactivate admin → next API call returns 401)
- [ ] `tests/unit/auth/` all pass
- [ ] `tests/unit/modules/booking/booking-state-machine.test.ts` all pass
- [ ] `tests/integration/api/admin/admin-auth.test.ts` all pass
- [ ] Rate limit test passes (5 failures → 429)
- [ ] `npm audit --audit-level=high` passes

### Gate 2 — After Milestone 2
- [ ] All Gate 1 checks still pass
- [ ] All public pages render without error when CMS is empty
- [ ] Admin CMS settings editor saves and changes are reflected on public site
- [ ] axe-core: 0 critical violations on all public pages
- [ ] Lighthouse mobile ≥ 80 on home and courts pages
- [ ] `tests/unit/modules/cms/` all pass
- [ ] `tests/integration/api/admin/cms-management.test.ts` all pass
- [ ] OBD-003 confirmed (language) OR issue formally deferred with owner sign-off

### Gate 3 — After Milestone 3
- [ ] All Gate 2 checks still pass
- [ ] Full booking flow works end-to-end
- [ ] `tests/unit/modules/pricing/price-calculator.test.ts` 95%+ coverage, all pass
- [ ] `tests/unit/modules/availability/conflict-detector.test.ts` 100% branch coverage, all pass
- [ ] `tests/unit/modules/booking/booking-state-machine.test.ts` 100% branch coverage, all pass
- [ ] **All 10 double-booking integration tests pass** (Section 12.3 — non-negotiable)
- [ ] Price manipulation tests pass
- [ ] Expiry job integration tests pass
- [ ] `tests/e2e/customer/full-booking-flow.spec.ts` passes on 390px viewport
- [ ] BOOKING_EXPIRY_MINUTES confirmed and set (OBD-002 resolved)
- [ ] OBD-004 confirmed (operating schedule populated in DB)

### Gate 4 — After Milestone 4
- [ ] All Gate 3 checks still pass
- [ ] Proof upload: JPEG, PNG, PDF accepted
- [ ] Proof upload: PHP file rejected with correct error
- [ ] Proof upload: 11MB file rejected
- [ ] Private bucket: direct URL (no signature) returns 403
- [ ] Signed URL access works and expires correctly
- [ ] Proof access logged in audit_logs
- [ ] Concurrent admin approval test passes
- [ ] `tests/integration/api/bookings/proof-upload.test.ts` all pass
- [ ] `tests/e2e/admin/approve-booking.spec.ts` passes

### Gate 5 — After Milestone 5
- [ ] All Gate 4 checks still pass
- [ ] Full admin operational loop works end-to-end
- [ ] Court management: add court appears in booking flow
- [ ] Schedule management: blocked date appears in date picker
- [ ] Administrator management: deactivation takes immediate effect
- [ ] Audit log: all admin actions recorded
- [ ] `tests/e2e/admin/` all pass
- [ ] `tests/e2e/security/unauthorized-access.spec.ts` all pass
- [ ] Test coverage report: ≥ 85% on booking engine modules, ≥ 70% overall

### Gate 6 — Launch Gate (After Milestone 6)
All items in the Definition of Done (Section 19).

---

## Section 19: Definition of Done for Version 1

Version 1 of The Field is complete and production-ready when **every item below is satisfied**.

### Code and Architecture
- [ ] All P1 functional requirements from Doc 02 implemented
- [ ] All 7 Required Changes from the Architecture Review (Doc 21) applied and verified
- [ ] No multi-venue, marketplace, or platform-level functionality visible to customers or admins
- [ ] No hardcoded business values: venue name editable via CMS, InstaPay number editable via CMS, prices in DB, operating hours in DB
- [ ] Booking reference prefix sourced from `venues.booking_ref_prefix`
- [ ] File upload non-blocking: booking reference always returned regardless of upload outcome
- [ ] `BOOKING_EXPIRY_MINUTES` configured (OBD-002 resolved)
- [ ] Language decision (OBD-003) resolved and implemented
- [ ] Operating schedule configured (OBD-004 resolved)
- [ ] Cancellation policy (OBD-001) resolved and implemented or formally deferred with owner sign-off
- [ ] `payment_submitted` indefinite hold (OBD-005) accepted in writing by venue owner

### Database
- [ ] `btree_gist` extension installed and verified
- [ ] `booking_range TSTZRANGE GENERATED ALWAYS AS (...)` column present
- [ ] Exclusion constraint `no_overlapping_approved_bookings` active
- [ ] Direct SQL double-approved-booking insert raises error `23P01`
- [ ] Partial unique index `uq_court_name_per_venue_active` active
- [ ] `must_change_password` column on `admin_users`
- [ ] `payment_proof_viewed` in `audit_action` enum
- [ ] `booking_ref_prefix` on `venues`
- [ ] `app_user` cannot DELETE bookings, payment_records, payment_proofs
- [ ] `app_user` cannot UPDATE or DELETE audit_logs
- [ ] All migrations idempotent and versioned

### Security
- [ ] HTTPS enforced with HSTS preload
- [ ] securityheaders.com grade B or above
- [ ] Admin session cookie: HttpOnly, Secure, SameSite=Lax, Path=/admin
- [ ] bcrypt cost factor 12 verified
- [ ] Brute-force protection: 5 failures/15min per IP → 429
- [ ] Semgrep: 0 high findings
- [ ] npm audit: 0 critical/high CVEs
- [ ] gitleaks: 0 secrets in git history
- [ ] OWASP ZAP baseline: 0 high/critical findings
- [ ] Burp Suite manual review completed
- [ ] IDOR protection: all admin queries scoped to `venueConfig.id`
- [ ] Payment proof not publicly accessible without signed URL
- [ ] Proof access logged in audit_logs with `payment_proof_viewed`

### Testing
- [ ] `tests/unit/modules/booking/booking-state-machine.test.ts`: 100% branch coverage, all pass
- [ ] `tests/unit/modules/pricing/price-calculator.test.ts`: ≥ 95% coverage, all pass
- [ ] `tests/unit/modules/availability/conflict-detector.test.ts`: 100% branch coverage, all pass
- [ ] All 10 double-booking integration tests pass (concurrent requests, adjacent slots, different courts, different dates, cancelled/rejected/expired release, two admins, stale approval, payment-submitted conflict)
- [ ] Price manipulation tests pass (server ignores any client-submitted price)
- [ ] IDOR tests pass (a different authenticated account receives not-found for a booking lookup)
- [ ] Proof upload security tests pass (PHP, SVG, oversized rejected)
- [ ] `tests/e2e/customer/full-booking-flow.spec.ts` passes on 390px viewport
- [ ] `tests/e2e/security/unauthorized-access.spec.ts` all pass
- [ ] `tests/e2e/admin/approve-booking.spec.ts` passes
- [ ] axe-core: 0 critical accessibility violations
- [ ] Lighthouse mobile ≥ 85 on home page and booking page
- [ ] Overall test coverage ≥ 70%

### Operations
- [ ] PM2 starts automatically after VPS reboot (verified by simulated reboot)
- [ ] Database backup script running daily and uploading to R2
- [ ] Test restore completed successfully from a real backup
- [ ] UptimeRobot monitors active and verified (downtime alert tested)
- [ ] Sentry receiving errors (test error verified)
- [ ] `NODE_ENV=production` set
- [ ] No real secrets in any environment files committed to git
- [ ] Initial seed admin credentials changed (`must_change_password = false` for all active admins)
- [ ] `.env.example` complete and accurate

### Acceptance
- [ ] Venue owner has manually completed a full test booking and confirmed the admin approval flow on production
- [ ] Venue owner can update InstaPay number, add FAQ, block a date, and update operating hours without developer assistance
- [ ] Privacy policy page live at `/privacy`
- [ ] README and admin onboarding guide complete
- [ ] All 5 Open Business Decisions either resolved and implemented, or formally accepted as deferred with owner sign-off documented

---

*Implementation Blueprint — The Field V1 — August 31, 2026*  
*Document: 22-implementation-blueprint.md*  
*This is the final handoff document for the coding agent. All architectural decisions, required changes, business rules, and task-level implementation details are contained in this document and the 21 specification documents it references.*  
*Do not begin production coding until OBD-003 (language) and OBD-004 (operating schedule) are confirmed by the venue owner.*
