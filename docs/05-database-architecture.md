# Database Architecture
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. Design Principles

1. **Venue-aware from day one.** Every resource that belongs to The Field is linked to a `venues` row. The customer never sees multi-venue UI in V1, but the schema does not have to be rewritten for multi-venue support.
2. **Immutable financial records.** Once a booking is created, its `price_amount` and `currency` must never be updated. Price changes affect only future bookings.
3. **Append-only audit log.** No `UPDATE` or `DELETE` is ever issued against the `audit_logs` table.
4. **Soft deletion.** Courts, pricing rules, CMS content, and admin accounts use `deleted_at` timestamps rather than hard deletes, preserving referential integrity for historical records.
5. **UTC timestamps everywhere.** All `TIMESTAMPTZ` columns are stored in UTC.
6. **Booking integrity enforced at DB level.** An exclusion constraint prevents two approved bookings from overlapping for the same court.

---

## 2. Extensions Required

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- UUID generation
CREATE EXTENSION IF NOT EXISTS "btree_gist";  -- Required for exclusion constraints on non-range types
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid() alternative
```

---

## 3. Schema Overview

```
venues
  │
  ├── courts ──────────────────────────────────────┐
  │     └── court_pricing_rules                    │
  │                                                │
  ├── operating_hours                              │
  ├── blocked_dates                                │
  ├── blocked_time_periods ────────────────────────┤
  ├── maintenance_periods ─────────────────────────┤
  │                                                │
  ├── bookings ◄───────────────────────────────────┘
  │     ├── customers (phone-based identity)
  │     └── payment_records
  │           └── payment_proofs
  │
  ├── admin_users
  │     ├── admin_roles
  │     └── admin_role_permissions
  │
  ├── audit_logs
  │
  └── cms_settings (key-value)
        ├── faqs
        ├── gallery_items
        ├── events
        ├── announcements
        └── social_links
```

---

## 4. Table Definitions

### 4.1 venues

```sql
CREATE TABLE venues (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            VARCHAR(100) NOT NULL UNIQUE,  -- 'the-field' (future: 'club-cairo')
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    address         TEXT,
    city            VARCHAR(100),
    country         VARCHAR(100) DEFAULT 'Egypt',
    timezone        VARCHAR(50) NOT NULL DEFAULT 'Africa/Cairo',
    currency        CHAR(3) NOT NULL DEFAULT 'EGP',
    -- Booking reference prefix: 'TF' for The Field. Sourced from DB, never hardcoded.
    -- Future venues each get their own prefix (e.g., 'CC' for Club Cairo).
    booking_ref_prefix VARCHAR(10) NOT NULL DEFAULT 'TF',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_venues_slug ON venues(slug) WHERE deleted_at IS NULL;
```

**Why:** The V1 application has exactly one row in this table. The `slug` allows future URL routing like `/venues/the-field`. Keeping this table means `courts`, `bookings`, and `operating_hours` can join to it, making venue scoping trivial to add later.

---

### 4.2 courts

```sql
CREATE TABLE courts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id        UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    court_type      VARCHAR(50) NOT NULL DEFAULT 'padel',  -- enum: 'padel', 'padel_covered', etc.
    features        JSONB,              -- ["covered", "lights", "premium_surface"]
    display_order   INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
    -- NOTE: No inline UNIQUE constraint here. A partial unique index is used instead
    -- because PostgreSQL treats NULL != NULL in UNIQUE constraints, which would allow
    -- two active courts (deleted_at IS NULL) with the same name to coexist.
);

-- Correct partial unique index: enforces name uniqueness among active courts only.
-- Soft-deleted courts are excluded, allowing name reuse after deletion.
CREATE UNIQUE INDEX uq_court_name_per_venue_active
    ON courts (venue_id, name)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_courts_venue_active ON courts(venue_id, is_active) WHERE deleted_at IS NULL;
```

---

### 4.3 court_pricing_rules

```sql
CREATE TABLE court_pricing_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id        UUID NOT NULL REFERENCES courts(id) ON DELETE RESTRICT,
    label           VARCHAR(100) NOT NULL,  -- e.g. "Peak Hours", "Off-Peak"
    price_amount    NUMERIC(10, 2) NOT NULL CHECK (price_amount > 0),
    currency        CHAR(3) NOT NULL DEFAULT 'EGP',
    -- Which days this rule applies to (0=Sun, 1=Mon, ..., 6=Sat)
    applicable_days INTEGER[] NOT NULL,     -- e.g. ARRAY[4,5,6] for Thu/Fri/Sat
    -- Time range within a day
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    priority        INTEGER NOT NULL DEFAULT 0, -- higher priority wins when rules overlap
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,

    CONSTRAINT chk_pricing_time_range CHECK (start_time < end_time)
);

CREATE INDEX idx_pricing_court ON court_pricing_rules(court_id, is_active) WHERE deleted_at IS NULL;
```

**Price Calculation Logic (application layer):**
1. Find all active rules for the court where the booking's day-of-week is in `applicable_days` and `start_time ≤ booking_start < end_time`.
2. If multiple rules match, take the one with the highest `priority`.
3. If no rule matches, fall back to a `base_price` column on the court (or reject with "no pricing configured").
4. The calculated price is stored immutably on the booking record at creation time.

---

### 4.4 operating_hours

```sql
CREATE TABLE operating_hours (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id    UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sun
    open_time   TIME NOT NULL,
    close_time  TIME NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_hours_range CHECK (open_time < close_time),
    CONSTRAINT uq_operating_hours UNIQUE (venue_id, day_of_week)
);
```

---

### 4.5 blocked_dates

```sql
CREATE TABLE blocked_dates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id    UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
    blocked_date DATE NOT NULL,
    reason      VARCHAR(255),
    created_by  UUID NOT NULL REFERENCES admin_users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_blocked_date UNIQUE (venue_id, blocked_date)
);

CREATE INDEX idx_blocked_dates_venue ON blocked_dates(venue_id, blocked_date);
```

---

### 4.6 blocked_time_periods

```sql
CREATE TABLE blocked_time_periods (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id    UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
    court_id    UUID REFERENCES courts(id) ON DELETE RESTRICT,  -- NULL = all courts
    start_datetime TIMESTAMPTZ NOT NULL,
    end_datetime   TIMESTAMPTZ NOT NULL,
    reason      VARCHAR(255),
    created_by  UUID NOT NULL REFERENCES admin_users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_blocked_period CHECK (start_datetime < end_datetime)
);

CREATE INDEX idx_blocked_periods_venue ON blocked_time_periods(venue_id, start_datetime, end_datetime);
```

---

### 4.7 maintenance_periods

```sql
CREATE TABLE maintenance_periods (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id    UUID NOT NULL REFERENCES courts(id) ON DELETE RESTRICT,
    start_datetime TIMESTAMPTZ NOT NULL,
    end_datetime   TIMESTAMPTZ NOT NULL,
    reason      VARCHAR(255),
    created_by  UUID NOT NULL REFERENCES admin_users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_maintenance_period CHECK (start_datetime < end_datetime)
);

CREATE INDEX idx_maintenance_court ON maintenance_periods(court_id, start_datetime, end_datetime);
```

---

### 4.8 customer_accounts

```sql
CREATE TABLE customer_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255),                  -- NULL for Google-only accounts
    google_id       VARCHAR(255) UNIQUE,           -- NULL for email/password-only accounts
    phone_number    VARCHAR(20),                   -- Egyptian mobile: 01XXXXXXXXX
    full_name       VARCHAR(255) NOT NULL,
    notes           TEXT,                          -- internal admin notes
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_customer_auth_method CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL)
);

CREATE UNIQUE INDEX idx_customer_accounts_phone ON customer_accounts(phone_number) WHERE phone_number IS NOT NULL;
```

**Design note:** A customer account is the V1 booking identity. It is created through Google Sign-In or email/password authentication. Booking creation derives ownership from the authenticated session, never from a phone number or browser-supplied customer ID.

---

### 4.9 bookings

```sql
CREATE TYPE booking_status AS ENUM (
    'pending',
    'payment_submitted',
    'under_review',
    'approved',
    'rejected',
    'cancelled',
    'expired'
);

CREATE TABLE bookings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_reference   VARCHAR(20) NOT NULL UNIQUE,   -- e.g. "TF-20260901-4X7K"
    venue_id            UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
    court_id            UUID NOT NULL REFERENCES courts(id) ON DELETE RESTRICT,
    customer_account_id UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,

    booking_date        DATE NOT NULL,
    start_time          TIME NOT NULL,
    end_time            TIME NOT NULL,

    -- Immutable financial record
    price_amount        NUMERIC(10, 2) NOT NULL CHECK (price_amount > 0),
    currency            CHAR(3) NOT NULL DEFAULT 'EGP',

    status              booking_status NOT NULL DEFAULT 'pending',

    -- Who acted on it
    approved_by         UUID REFERENCES admin_users(id),
    approved_at         TIMESTAMPTZ,
    rejected_by         UUID REFERENCES admin_users(id),
    rejected_at         TIMESTAMPTZ,
    rejection_reason    TEXT,
    cancelled_by        UUID REFERENCES admin_users(id),
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT,
    expires_at          TIMESTAMPTZ,    -- set at creation; NULL once approved

    -- Metadata
    notes               TEXT,
    ip_address          INET,
    user_agent          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Structural constraints
    CONSTRAINT chk_booking_time_range CHECK (start_time < end_time)
    -- NOTE: chk_booking_date_future removed. PostgreSQL CURRENT_DATE is UTC, but the
    -- venue operates at UTC+2 (Egypt). A booking at 22:30 EGT for 23:00–24:00 that
    -- same evening would fail the constraint because UTC date is already "tomorrow".
    -- Date validation is enforced at the application service layer instead.
);

-- Performance indexes
CREATE INDEX idx_bookings_court_date ON bookings(court_id, booking_date);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_customer_account ON bookings(customer_account_id);
CREATE INDEX idx_bookings_reference ON bookings(booking_reference);
CREATE INDEX idx_bookings_expires ON bookings(expires_at) WHERE status IN ('pending', 'payment_submitted');

-- ── BOOKING RANGE — Generated Column ─────────────────────────────────────────
-- Combines booking_date + start_time / end_time into a timezone-aware tstzrange.
-- This is required for the exclusion constraint because PostgreSQL has no native
-- 'timerange' type. The generated column is STORED (persisted + indexed).
-- Timezone is hardcoded to 'Africa/Cairo' (UTC+2, Egyptian Standard Time).
-- If the venue timezone ever changes, a migration updates this expression.
booking_range TSTZRANGE GENERATED ALWAYS AS (
    tstzrange(
        (booking_date + start_time) AT TIME ZONE 'Africa/Cairo',
        (booking_date + end_time)   AT TIME ZONE 'Africa/Cairo'
    )
) STORED,
```

**Note on `booking_range`:** The generated column eliminates the need for a separate `timerange` type (which does not exist in PostgreSQL). It combines the date and time dimensions into a single `TSTZRANGE` using the venue's timezone. This correctly handles midnight-crossing slots and allows the `&&` overlap operator to work in the exclusion constraint.

```sql
-- THE CRITICAL INTEGRITY CONSTRAINT
-- Prevents two 'approved' bookings from overlapping on the same court.
-- Requires btree_gist extension (install via: apt install postgresql-16-contrib).
-- VERIFY btree_gist is available BEFORE running this migration (Milestone 0, Task 1).
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings ADD CONSTRAINT no_overlapping_approved_bookings
    EXCLUDE USING GIST (
        court_id      WITH =,
        booking_range WITH &&
    ) WHERE (status = 'approved');
```

**Why `booking_range TSTZRANGE` not `timerange`:** PostgreSQL has no `timerange` built-in type. Using a generated `TSTZRANGE` column is the correct approach. The `&&` overlap operator on `TSTZRANGE` correctly identifies: full overlap, partial overlap, and containment. Adjacent slots (19:00–20:00 and 20:00–21:00) do not overlap under this operator — boundary-sharing ranges are NOT considered overlapping in PostgreSQL range semantics.

**Note on `chk_booking_date_future`:** This constraint has been intentionally REMOVED. Using `CURRENT_DATE` (UTC) against `booking_date` (Egypt time, UTC+2) causes valid same-day bookings submitted after 22:00 local time to be incorrectly rejected. Date validation is enforced by the application service layer instead, where timezone-aware comparison is straightforward.

---

### 4.10 payment_records

```sql
CREATE TYPE payment_status AS ENUM (
    'pending',
    'submitted',
    'verified',
    'rejected'
);

CREATE TABLE payment_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id      UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
    amount          NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    currency        CHAR(3) NOT NULL DEFAULT 'EGP',
    payment_method  VARCHAR(50) NOT NULL DEFAULT 'instapay',
    status          payment_status NOT NULL DEFAULT 'pending',

    -- Submission
    proof_submitted_at TIMESTAMPTZ,
    submitted_by_ip    INET,

    -- Verification
    verified_by     UUID REFERENCES admin_users(id),
    verified_at     TIMESTAMPTZ,

    -- Rejection
    rejected_by     UUID REFERENCES admin_users(id),
    rejected_at     TIMESTAMPTZ,
    rejection_reason TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_booking ON payment_records(booking_id);
CREATE INDEX idx_payments_status ON payment_records(status);
```

---

### 4.11 payment_proofs

```sql
CREATE TABLE payment_proofs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id      UUID NOT NULL REFERENCES payment_records(id) ON DELETE RESTRICT,
    -- Internal storage path or object key (never a public URL)
    storage_key     VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255),
    file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
    mime_type       VARCHAR(100) NOT NULL,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    uploaded_by_ip  INET,
    -- Admin who reviewed this specific proof file
    reviewed_by     UUID REFERENCES admin_users(id),
    reviewed_at     TIMESTAMPTZ
);

CREATE INDEX idx_proofs_payment ON payment_proofs(payment_id);
```

---

### 4.12 admin_roles

```sql
CREATE TABLE admin_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(50) NOT NULL UNIQUE,   -- 'super_admin', 'admin', 'viewer'
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE admin_role_permissions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id     UUID NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
    permission  VARCHAR(100) NOT NULL,  -- e.g. 'approve_booking', 'verify_payment'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_role_permission UNIQUE (role_id, permission)
);

CREATE INDEX idx_role_permissions ON admin_role_permissions(role_id);
```

**Defined Permissions:**

| Permission | Description |
|-----------|-------------|
| `view_bookings` | View booking list and details |
| `approve_booking` | Approve a pending booking |
| `reject_booking` | Reject a pending booking |
| `cancel_booking` | Cancel a confirmed booking |
| `verify_payment` | Mark a payment as verified |
| `reject_payment` | Mark a payment as rejected |
| `view_payment_proof` | View uploaded payment proof files |
| `manage_courts` | Add, edit, disable courts |
| `manage_pricing` | Create and modify pricing rules |
| `manage_schedule` | Manage operating hours, blocked dates, maintenance |
| `manage_customers` | View and search customers |
| `manage_cms` | Edit website content |
| `manage_admins` | Create and manage admin accounts (super_admin only) |
| `view_audit_logs` | View the audit log |
| `manage_settings` | System settings |

---

### 4.13 admin_users

```sql
CREATE TABLE admin_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,   -- bcrypt, cost ≥ 12
    full_name       VARCHAR(255) NOT NULL,
    role_id         UUID NOT NULL REFERENCES admin_roles(id) ON DELETE RESTRICT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    -- Forces password change on next login (set TRUE for temporary/new passwords)
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at   TIMESTAMPTZ,
    last_login_ip   INET,
    created_by      UUID REFERENCES admin_users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,

    -- Session revocation: any session issued before this timestamp is invalid
    sessions_invalidated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_admin_email ON admin_users(email) WHERE deleted_at IS NULL;
```

---

### 4.14 audit_logs

```sql
CREATE TYPE audit_action AS ENUM (
    'booking_created', 'booking_approved', 'booking_rejected',
    'booking_cancelled', 'booking_expired',
    'payment_verified', 'payment_rejected',
    'payment_proof_viewed',                  -- added: RC-007a
    'court_created', 'court_updated', 'court_disabled',
    'pricing_created', 'pricing_updated', 'pricing_deleted',
    'schedule_updated', 'date_blocked', 'period_blocked', 'maintenance_created',
    'admin_created', 'admin_updated', 'admin_deactivated',
    'cms_updated',
    'admin_login', 'admin_logout', 'admin_login_failed'
);

CREATE TABLE audit_logs (
    id              BIGSERIAL PRIMARY KEY,   -- Sequential for ordered viewing
    admin_id        UUID REFERENCES admin_users(id),   -- NULL for system actions
    action          audit_action NOT NULL,
    entity_type     VARCHAR(50),    -- 'booking', 'court', 'payment', etc.
    entity_id       UUID,
    -- Before/after snapshot (partial, only changed fields)
    old_value       JSONB,
    new_value       JSONB,
    metadata        JSONB,          -- IP address, user agent, request ID
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()

    -- No updated_at — this table is append-only
    -- No deleted_at — records are never deleted
);

-- Revoke UPDATE and DELETE on this table in the DB role used by the application
-- (enforced at PostgreSQL role level, not just application level)
REVOKE UPDATE, DELETE ON audit_logs FROM app_user;

CREATE INDEX idx_audit_admin ON audit_logs(admin_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
```

---

### 4.15 CMS Tables

#### cms_site_settings (key-value store for simple settings)

```sql
CREATE TABLE cms_site_settings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id    UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
    key         VARCHAR(100) NOT NULL,
    value       TEXT,
    value_type  VARCHAR(20) NOT NULL DEFAULT 'text',  -- 'text', 'json', 'boolean', 'number'
    label       VARCHAR(255),       -- human-readable label for admin UI
    group_name  VARCHAR(100),       -- 'contact', 'payment', 'seo', 'social'
    updated_by  UUID REFERENCES admin_users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_cms_key UNIQUE (venue_id, key)
);

CREATE INDEX idx_cms_group ON cms_site_settings(venue_id, group_name);
```

**Well-known keys:**

| Key | Group | Description |
|-----|-------|-------------|
| `venue.name` | general | Display name |
| `venue.phone` | contact | Public phone number |
| `venue.whatsapp` | contact | WhatsApp number |
| `venue.email` | contact | Contact email |
| `venue.address` | contact | Full address |
| `venue.map_embed_url` | contact | Google Maps embed URL |
| `venue.instapay_number` | payment | Customer-facing InstaPay number |
| `venue.instapay_instructions` | payment | Payment instruction text |
| `homepage.hero_headline` | homepage | Hero section headline |
| `homepage.hero_subtitle` | homepage | Hero section subtitle |
| `homepage.hero_cta_label` | homepage | CTA button label |
| `seo.default_title` | seo | Default meta title |
| `seo.default_description` | seo | Default meta description |

#### cms_faqs

```sql
CREATE TABLE cms_faqs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id        UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
    question        TEXT NOT NULL,
    answer          TEXT NOT NULL,
    display_order   INTEGER NOT NULL DEFAULT 0,
    is_published    BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID REFERENCES admin_users(id),
    updated_by      UUID REFERENCES admin_users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);
```

#### cms_gallery_items

```sql
CREATE TABLE cms_gallery_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id        UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
    storage_key     VARCHAR(500) NOT NULL,   -- object storage key
    caption         TEXT,
    category        VARCHAR(100),
    display_order   INTEGER NOT NULL DEFAULT 0,
    is_published    BOOLEAN NOT NULL DEFAULT TRUE,
    uploaded_by     UUID REFERENCES admin_users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);
```

#### cms_events

```sql
CREATE TABLE cms_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id        UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
    title           VARCHAR(255) NOT NULL,
    slug            VARCHAR(255),
    description     TEXT,
    event_date      DATE,
    event_time      TIME,
    cover_image_key VARCHAR(500),
    is_published    BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      UUID REFERENCES admin_users(id),
    updated_by      UUID REFERENCES admin_users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);
```

#### cms_announcements

```sql
CREATE TABLE cms_announcements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id        UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
    title           VARCHAR(255) NOT NULL,
    body            TEXT NOT NULL,
    expires_at      TIMESTAMPTZ,
    is_published    BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      UUID REFERENCES admin_users(id),
    updated_by      UUID REFERENCES admin_users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### cms_social_links

```sql
CREATE TABLE cms_social_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id        UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
    platform        VARCHAR(50) NOT NULL,   -- 'instagram', 'facebook', 'tiktok', 'youtube'
    url             TEXT NOT NULL,
    display_order   INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by      UUID REFERENCES admin_users(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_social_platform UNIQUE (venue_id, platform)
);
```

---

## 5. Booking Reference Format

Format: `{PREFIX}-YYYYMMDD-XXXX`

- `PREFIX` = venue-specific prefix, sourced from `venues.booking_ref_prefix` (default: `TF` for The Field). **Never hardcoded in application code.**
- `YYYYMMDD` = booking date
- `XXXX` = 4-character random alphanumeric (uppercase, excluding ambiguous chars: 0, O, I, 1)

Example: `TF-20260905-K7M2`

Generation: Server-generated. The prefix is read from the venue record at booking creation time:

```typescript
const prefix = venue.booking_ref_prefix  // 'TF' for The Field
const ref = `${prefix}-${formatDate(bookingDate)}-${randomSuffix()}`
```

Uniqueness enforced by the `UNIQUE` constraint on `bookings.booking_reference`. If collision occurs (extremely rare), retry with a new random suffix.

**Why not UUID as reference?** UUIDs are hard to communicate verbally or over WhatsApp. A short, structured reference is customer-friendly.

---

## 6. Indexes Summary

| Table | Index Columns | Purpose |
|-------|--------------|---------|
| `venues` | `slug` | Venue lookup by slug |
| `courts` | `(venue_id, is_active)` | Active courts for a venue |
| `bookings` | `(court_id, booking_date)` | Availability checking |
| `bookings` | `(venue_id, status, booking_date DESC)` | Admin bookings list query |
| `bookings` | `status` | Filtering by status |
| `bookings` | `customer_account_id` | Customer booking history, scoped to the authenticated account |
| `bookings` | `booking_reference` | Reference lookup |
| `bookings` | `expires_at` (partial) | Expiry job query |
| `bookings` | `booking_range` (GiST, via exclusion constraint) | Overlap detection |
| `payment_records` | `booking_id` | Payment for a booking |
| `payment_records` | `status` | Filter by payment status |
| `payment_proofs` | `payment_id` | Proofs for a payment |
| `audit_logs` | `(admin_id, created_at)` | Admin activity feed |
| `audit_logs` | `(entity_type, entity_id)` | Entity history |
| `customer_accounts` | `phone_number` (partial) | Customer contact lookup |
| `admin_users` | `email` (partial) | Login lookup |
| `cms_site_settings` | `(venue_id, group_name)` | Settings by group |

---

## 7. Data Retention

| Data | Retention | Deletion Policy |
|------|-----------|-----------------|
| Booking records | Permanent | Never hard-deleted |
| Payment records | Permanent | Never hard-deleted |
| Payment proofs | Permanent | Never hard-deleted from DB; storage file retained |
| Audit logs | Minimum 2 years | Append-only, never deleted |
| Customer records | Indefinite (V1) | Soft-delete on explicit request |
| CMS content | Indefinite | Soft-delete |
| Courts | Indefinite | Soft-delete |
| Expired/cancelled bookings | Permanent | Status updated, record retained |

---

## 8. Migration Strategy

- Drizzle ORM manages schema migrations via `drizzle-kit`.
- Each migration is a TypeScript file that generates SQL.
- Migrations are run automatically on deployment via `npm run db:migrate`.
- Migrations are idempotent (checked against a `drizzle_migrations` table).
- Breaking migrations (column renames, type changes) require a multi-step approach: add new column → backfill → update app → remove old column.
- The V1 database seed script creates: one venue record, default operating hours, default admin role, and the initial super-admin user.

---

## 9. PostgreSQL Role Setup

```sql
-- Application user: limited permissions
CREATE ROLE app_user LOGIN PASSWORD '...';

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Explicitly revoke destructive operations on protected tables
REVOKE DELETE ON bookings FROM app_user;
REVOKE DELETE ON payment_records FROM app_user;
REVOKE DELETE ON payment_proofs FROM app_user;
REVOKE UPDATE, DELETE ON audit_logs FROM app_user;

-- Migration user: used only during deployments
CREATE ROLE migration_user LOGIN PASSWORD '...';
GRANT ALL PRIVILEGES ON DATABASE thefield TO migration_user;
```

This role separation ensures that even if the application is compromised, an attacker cannot delete booking or audit records directly through the application's database connection.
