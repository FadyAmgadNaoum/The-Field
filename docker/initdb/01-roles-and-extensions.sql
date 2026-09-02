-- =============================================================================
-- LOCAL DEVELOPMENT ONLY
-- =============================================================================
-- Executed once by the postgres:16-alpine entrypoint when the data volume is
-- first created. It reproduces locally the role separation and extension set
-- that a managed provider gives us in staging and production (Doc 24 §D.1).
--
-- These passwords are throwaway local values. They are not secrets and must
-- never appear in any other environment.
-- =============================================================================

-- Extensions must be created by a superuser; the app roles cannot do it.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- Runtime role. Privileges are applied by migration 0004 AFTER tables exist.
CREATE ROLE app_user LOGIN PASSWORD 'localdev';

-- Migration role — owns the schema.
CREATE ROLE migration_user LOGIN PASSWORD 'localdev';
GRANT ALL PRIVILEGES ON DATABASE thefield TO migration_user;
GRANT ALL ON SCHEMA public TO migration_user;

-- Backup role — SELECT only (Doc 21 DF-004).
CREATE ROLE backup_user LOGIN PASSWORD 'localdev';
GRANT CONNECT ON DATABASE thefield TO backup_user;

GRANT CONNECT ON DATABASE thefield TO app_user;
