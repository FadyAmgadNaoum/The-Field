-- =============================================================================
-- 0001 — BOOKING INTEGRITY
-- =============================================================================
-- This file contains the single most important guarantee in the system: it is
-- physically impossible for two approved bookings to overlap on the same court.
--
-- Doc 23 §4.2 and Doc 24 §M item 1: this constraint is never weakened, dropped,
-- or made conditional. Application-level checks are supplementary.
--
-- Runs AFTER the Drizzle migrations have created the `bookings` table.
-- Idempotent — safe to re-run on every deployment (Doc 23 §13.6).
-- =============================================================================

-- ── Extensions ───────────────────────────────────────────────────────────────
-- btree_gist is what lets a GiST exclusion constraint mix an equality operator
-- on a scalar column (court_id, a UUID) with an overlap operator on a range.
-- Without it the constraint below cannot be created (Doc 05 §2, Doc 20 R-TECH-001).
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RAISE EXCEPTION
      'btree_gist is not installed. The double-booking guarantee cannot be created. %',
      'Install postgresql-16-contrib, or choose a managed provider that supports it (Doc 24 §D.1).';
  END IF;
END $$;

-- ── booking_range ────────────────────────────────────────────────────────────
-- Doc 24 §D.2.
--
-- Docs 05 §4.9, 21 RC-001 and 22 §4.3 specify a TSTZRANGE built with
-- `AT TIME ZONE 'Africa/Cairo'`. That expression CANNOT be used here:
-- PostgreSQL requires the generation expression of a STORED generated column to
-- be IMMUTABLE, and `timestamp AT TIME ZONE text` is STABLE because it depends
-- on the installed timezone database. Creating it fails with:
--
--     ERROR:  generation expression is not immutable
--
-- The replacement below is immutable and equivalent for this system:
--
--   * `date + time -> timestamp` (datetime_pl) is IMMUTABLE — pure arithmetic.
--   * `tsrange(timestamp, timestamp)` is IMMUTABLE.
--   * booking_date and start_time/end_time already hold venue-local wall-clock
--     values, and the venue operates in exactly one fixed timezone
--     (Doc 01 A4). For a single-timezone venue, wall-clock overlap and
--     absolute-time overlap coincide.
--   * At the autumn DST transition one wall-clock hour occurs twice in absolute
--     time. Wall-clock ranges treat that as ONE bookable slot and refuse the
--     second approval — stricter than TSTZRANGE, and correct operationally.
--     The representation can only ever prevent a double booking, never permit one.
--
-- `end_time` may be '24:00:00' for the final slot of a midnight close;
-- `booking_date + '24:00'::time` correctly yields next-day 00:00 (Doc 24 §F.4).
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_range TSRANGE
  GENERATED ALWAYS AS (
    tsrange(booking_date + start_time, booking_date + end_time)
  ) STORED;

-- ── The exclusion constraint ─────────────────────────────────────────────────
-- Same court + overlapping time + both approved  ->  rejected with SQLSTATE 23P01.
--
-- Scope is `status = 'approved'` only. Two `pending` bookings for one slot can
-- coexist; that race is documented and accepted (Doc 06 §5, Doc 21 RC-004) and
-- only one of them can ever reach `approved`.
--
-- Adjacent ranges (18:00-19:00 and 19:00-20:00) do NOT overlap under `&&`.
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS no_overlapping_approved_bookings;

ALTER TABLE bookings
  ADD CONSTRAINT no_overlapping_approved_bookings
  EXCLUDE USING GIST (
    court_id      WITH =,
    booking_range WITH &&
  ) WHERE (status = 'approved');

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'no_overlapping_approved_bookings'
  ) THEN
    RAISE EXCEPTION 'no_overlapping_approved_bookings was not created.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'booking_range'
  ) THEN
    RAISE EXCEPTION 'booking_range column was not created.';
  END IF;
END $$;
