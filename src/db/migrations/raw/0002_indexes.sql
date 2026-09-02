-- =============================================================================
-- 0002 — PARTIAL AND COMPOSITE INDEXES
-- =============================================================================
-- Partial indexes cannot be expressed in the Drizzle schema DSL, so they live
-- here. Idempotent (Doc 23 §13.6).
-- =============================================================================

-- ── Courts: name uniqueness among ACTIVE courts only ─────────────────────────
-- RC-006 (Doc 21 §3). The original `UNIQUE (venue_id, name, deleted_at)` is
-- semantically broken: PostgreSQL treats NULLs as distinct, so two active courts
-- (both deleted_at = NULL) could share a name. A partial unique index is the
-- correct construction — and it still allows a soft-deleted court's name to be
-- reused.
CREATE UNIQUE INDEX IF NOT EXISTS uq_court_name_per_venue_active
  ON courts (venue_id, name)
  WHERE deleted_at IS NULL;

-- ── Venues: slug lookup ──────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_slug
  ON venues (slug)
  WHERE deleted_at IS NULL;

-- ── Admin users: email lookup among live accounts ────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_email
  ON admin_users (email)
  WHERE deleted_at IS NULL;

-- ── Customer accounts: phone lookup ──────────────────────────────────────────
-- Contact data only. Phone is NEVER an identity or authorisation mechanism
-- (Doc 24 §E.1). A duplicate must surface as a field-level validation error,
-- never a 500 (Doc 24 §K NEW-3).
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_accounts_phone
  ON customer_accounts (phone_number)
  WHERE phone_number IS NOT NULL;

-- ── Bookings: expiry job ─────────────────────────────────────────────────────
-- The expiry job scans for pending bookings past expires_at (Doc 06 §8).
CREATE INDEX IF NOT EXISTS idx_bookings_expires
  ON bookings (expires_at)
  WHERE status IN ('pending', 'payment_submitted');

-- ── Bookings: admin list query ───────────────────────────────────────────────
-- Doc 21 DBF-001 recommends this composite index with `WHERE deleted_at IS NULL`.
-- The `bookings` table has no deleted_at column, and correctly so: bookings are
-- never deleted, only status-transitioned (Doc 03 NFR-DATA-007). The predicate
-- is therefore dropped; the index itself is created as recommended.
CREATE INDEX IF NOT EXISTS idx_bookings_admin_list
  ON bookings (venue_id, status, booking_date DESC);
