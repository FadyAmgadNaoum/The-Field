-- =============================================================================
-- 0003 — CHECK CONSTRAINTS
-- =============================================================================
-- Doc 03 NFR-SEC-010 requires validation at both the API layer and the database
-- constraint layer. Drizzle 0.33's schema DSL cannot express CHECK constraints,
-- so they are declared here. Idempotent.
--
-- NOTE: `chk_booking_date_future` is deliberately ABSENT — RC-005 (Doc 21 §3).
-- CURRENT_DATE is UTC while the venue runs at UTC+2, so it would reject a valid
-- same-evening booking made after 22:00 local time. The service layer performs
-- the timezone-aware comparison instead.
-- =============================================================================

CREATE OR REPLACE FUNCTION __add_check(
  target_table TEXT,
  constraint_name TEXT,
  expression TEXT
) RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = constraint_name
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)',
                   target_table, constraint_name, expression);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ── Time ranges must be ordered ──────────────────────────────────────────────
-- start < end holds for '23:00' < '24:00' (Doc 24 §F.4).
SELECT __add_check('bookings', 'chk_booking_time_range', 'start_time < end_time');
SELECT __add_check('court_pricing_rules', 'chk_pricing_time_range', 'start_time < end_time');
SELECT __add_check('operating_hours', 'chk_hours_range', 'open_time < close_time');
SELECT __add_check('blocked_time_periods', 'chk_blocked_period', 'start_datetime < end_datetime');
SELECT __add_check('maintenance_periods', 'chk_maintenance_period', 'start_datetime < end_datetime');

-- ── Day of week domain ───────────────────────────────────────────────────────
SELECT __add_check('operating_hours', 'chk_day_of_week', 'day_of_week BETWEEN 0 AND 6');

-- ── Monetary amounts ─────────────────────────────────────────────────────────
SELECT __add_check('bookings', 'chk_booking_price_positive', 'price_amount > 0');
SELECT __add_check('court_pricing_rules', 'chk_pricing_price_positive', 'price_amount > 0');
SELECT __add_check('payment_records', 'chk_payment_amount_positive', 'amount > 0');

-- ── Upload size ceiling (10MB — Doc 02 FR-PAY-004) ───────────────────────────
SELECT __add_check(
  'payment_proofs',
  'chk_proof_file_size',
  'file_size_bytes > 0 AND file_size_bytes <= 10485760'
);

-- ── Every customer account must have at least one authentication method ──────
-- Doc 05 §4.8. Google-only accounts have no password hash; email/password
-- accounts have no google_id.
SELECT __add_check(
  'customer_accounts',
  'chk_customer_auth_method',
  'password_hash IS NOT NULL OR google_id IS NOT NULL'
);

DROP FUNCTION __add_check(TEXT, TEXT, TEXT);
