-- =============================================================================
-- 0004 — DATABASE ROLE PRIVILEGES
-- =============================================================================
-- Defence in depth: even a fully compromised application process cannot delete
-- a booking or tamper with the audit log, because the connection it holds has
-- no such right (Doc 05 §9, Doc 03 NFR-DATA-008, Doc 24 §M item 8).
--
-- ORDERING MATTERS — Doc 24 §D.1 / §K S19n:
-- Doc 22 §14.1 issues `GRANT ... ON ALL TABLES` at role-creation time, BEFORE
-- migrations create any table. `ON ALL TABLES` only covers tables that exist at
-- that moment, so app_user would end up with no rights at all, and the
-- audit_logs REVOKE would silently apply to nothing. This file therefore runs
-- AFTER every migration, and adds ALTER DEFAULT PRIVILEGES so that tables
-- created by future migrations inherit the same grants automatically.
--
-- Idempotent. Skips cleanly when the roles do not exist (e.g. a managed
-- provider where roles are provisioned through its console).
-- =============================================================================

DO $$
DECLARE
  app_role      CONSTANT TEXT := 'app_user';
  backup_role   CONSTANT TEXT := 'backup_user';
  current_owner CONSTANT TEXT := current_user;
BEGIN
  -- ── app_user: runtime connection ───────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN

    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO %I', app_role);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app_role);

    -- Tables created by future migrations inherit these automatically.
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
         GRANT SELECT, INSERT, UPDATE ON TABLES TO %I',
      current_owner, app_role);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
         GRANT USAGE, SELECT ON SEQUENCES TO %I',
      current_owner, app_role);

    -- Financial and booking records are never hard-deleted (Doc 03 NFR-DATA-007).
    EXECUTE format('REVOKE DELETE ON bookings         FROM %I', app_role);
    EXECUTE format('REVOKE DELETE ON payment_records  FROM %I', app_role);
    EXECUTE format('REVOKE DELETE ON payment_proofs   FROM %I', app_role);

    -- The audit log is append-only. INSERT only — no UPDATE, no DELETE.
    EXECUTE format('REVOKE UPDATE, DELETE ON audit_logs FROM %I', app_role);

    RAISE NOTICE 'Privileges applied for role %', app_role;
  ELSE
    RAISE NOTICE 'Role % does not exist — skipping. Create it before deploying (Doc 22 §4.4).', app_role;
  END IF;

  -- ── backup_user: SELECT only (Doc 21 DF-004) ───────────────────────────────
  -- Using the application credentials for backups means a leaked backup
  -- credential equals application access.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = backup_role) THEN
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', backup_role);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', backup_role);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO %I',
      current_owner, backup_role);
    RAISE NOTICE 'Privileges applied for role %', backup_role;
  ELSE
    RAISE NOTICE 'Role % does not exist — skipping.', backup_role;
  END IF;
END $$;
