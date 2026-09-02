# Specification Reconciliation and Decision Record
## The Field — Padel Court Booking Website
**Version:** 1.0
**Date:** September 2, 2026
**Status:** AUTHORITATIVE — Supersedes conflicting statements in Documents 00–23
**Purpose:** Establish one source of truth for implementation. No developer or agent should have to guess which document wins.

---

## Preamble

This document does not introduce new architecture. It resolves conflicts between existing specification documents, records the reasoning, and cites the source documents that support each decision. Where two documents disagree, this record states which one governs and why.

**Every decision below was checked against the source documents before being recorded.** Where a documented instruction is technically impossible (Section D.2), the replacement preserves the original guarantee rather than weakening it.

Three findings in this document were not present in any earlier review and are recorded here for the first time:
- **D.2** — the specified generated column is invalid PostgreSQL and will fail at migration time.
- **F.4** — the documented slot regex cannot express the final slot of a venue that closes at midnight.
- **I.5** — with Cloudflare in front of NGINX, the documented IP extraction collapses all users into one rate-limit bucket.

---

## A. Authority hierarchy

When documents conflict, apply this order. Higher entries win.

| Rank | Document(s) | Authority | Notes |
|------|------------|-----------|-------|
| 1 | **24-specification-reconciliation.md** (this document) | Final. Resolves all conflicts. | Only for the conflicts it addresses. Silent on everything else. |
| 2 | `23-production-reliability-architecture.md` | Infrastructure, deployment, reliability, monitoring, backup/DR, quality gates, Definition of Done | Self-declared: "Upgrades the deployment architecture defined in Docs 15 and 22" (`23…` header). Its §16 is the authoritative DoD (`23…` §16 preamble). |
| 3 | `22-implementation-blueprint.md` | Directory structure, module contracts, task breakdown, milestone content | Self-declared "FINAL — Ready for Coding Agent Handoff" (`22…` header). Superseded by 23 on infrastructure. |
| 4 | `21-architecture-review-report.md` | Required Changes RC-001…RC-007 are binding on the schema | Its §12 milestone-order confirmation is **superseded** — see §N. |
| 5 | `05`, `06`, `07`, `09`, `10`, `11`, `12`, `13`, `14` | Domain specifications: schema, state machine, payment, CMS, auth, API, storage, threats, tests | Superseded only where 21/22/23/24 explicitly override. |
| 6 | `01`, `02`, `03`, `19` | Requirements and acceptance criteria — **what must be true** | Remain authoritative on outcomes even when superseded on method. A reconciliation may change *how* a requirement is met, never *whether*. |
| 7 | `04`, `08`, `15`, `16`, `17`, `18`, `20`, `00` | Context, workflows, roadmap, risk register | Partially stale. See §K. |

**Tie-break rule:** later document + more specific scope wins, except that Documents 02, 03 and 19 are never overridden on *whether* a requirement exists.

**Stale-reference rule:** a document being stale in one section does not invalidate the rest of it. `04-system-architecture.md` remains the authority on module boundaries (§3, §10) even though its customer-identity and constraint sections are obsolete.

---

## B. Final architecture decisions

### B.1 Application pattern — modular monolith
**Decision:** One Next.js 14 App Router application. Domain modules under `src/modules/`. No microservices, no Kubernetes, no service mesh, no message broker.
**Source:** `04…` §1, §3; `22…` §1.1; `01…` C6; `03…` §3 rationale.

### B.2 Module boundaries are enforced, not advisory
**Decision:** Modules communicate only through service functions. No module queries another module's tables. Nothing imports `bookings` except `admin` and `notifications`.
**Source:** `04…` §3, §10; `22…` §1.3; `03…` NFR-MAINT-002.
**Consequence:** this rule directly determines the court-photo decision in §D.5.

### B.3 Layer responsibilities
**Decision:** Route handlers do HTTP + Zod only. Services own business rules and transactions and never touch `Request`/`Response`. Repositories run queries and contain no business logic. The database enforces invariants.
**Source:** `04…` §7; `22…` §5.2; `03…` NFR-MAINT-009.

### B.4 V1 scope boundary
**Decision:** The Field only. No venue selector, no venue listing, no venue onboarding, no venue-owner accounts, no marketplace UI. `VENUE_ID` is a server environment variable, never a URL parameter or request field. The schema stays venue-aware.
**Source:** `01…` §4.1; `22…` Preamble #1; `17…` §3.1, §7; `23…` §16.11.

### B.5 No unjustified infrastructure in V1
**Decision:** No Redis, no BullMQ, no PgBouncer, no HAProxy, no second VPS node, no Cloudflare paid tiers at launch. Each is documented as a Tier 3 upgrade with a measured trigger.
**Source:** `23…` §13.2 ("What is NOT required on day one"), §13.3; `04…` §8.5.

---

## C. Final technology decisions

### C.1 PostgreSQL driver — `pg` v8 + `drizzle-orm/node-postgres`
**Decision:** Use node-postgres (`pg` ^8.x) with `drizzle-orm/node-postgres`. Do **not** use postgres.js.
**Conflict resolved:** `22…` §2 lists `postgres (pg) ^3.4.0`, conflating the `postgres` package (postgres.js, v3.x) with `pg` (node-postgres, v8.x). `23…` §2.4 gives working code importing `Pool` from `pg` and `drizzle` from `drizzle-orm/node-postgres`.
**Rationale:** `23…` outranks `22…` and its version is the one with executable code behind it. `pg.Pool` also exposes the `max`/`min`/`idleTimeoutMillis`/`connectionTimeoutMillis`/`statement_timeout` surface that `23…` §2.4 and REL-M0-T04 require, and the `pool.on('error')` hook used for the Sentry forwarding requirement.
**Source:** `23…` §2.4, REL-M0-T04; corrects `22…` §2.

### C.2 Middleware location — `src/middleware.ts`
**Decision:** `src/middleware.ts`. Never `src/app/middleware.ts`.
**Conflict resolved:** `22…` §3 and §6.5 place it under `src/app/`; `04…` §3 has it correct at `src/middleware.ts`.
**Rationale:** Next.js only detects middleware at the project root or `src/` root. The blueprint's path would produce a file that is never executed — silently disabling every security header, the CSP nonce, and request-ID propagation, while all tests that check headers via the app router would still pass locally. This is a correctness issue, not a preference.
**Source:** `04…` §3; corrects `22…` §3, §6.5. Affected tasks: M1-T10, REL-M0-T05.

### C.3 Internationalisation — next-intl, bilingual AR/EN, RTL
**Decision:** OBD-003 is **RESOLVED: bilingual Arabic + English with full RTL**. `next-intl` is in scope from Milestone 2. All customer-facing strings live in `messages/en.json` and `messages/ar.json`; no hardcoded UI strings in JSX. Locale by URL prefix (`/en/`, `/ar/`), `dir` attribute switched on `<html>`, Tailwind `rtl:` variants and logical properties, Arabic-capable font stack. Admin dashboard is English-only in V1.
**Conflict resolved:** `00-index.md` OBD-003 row and `21…` §9 record it as unresolved with an English-only default; `22…` §2 lists next-intl under "Not in V1 — pending OBD-003" and M2-T04 designs for a single `NEXT_PUBLIC_LOCALE`. All four are **stale**.
**Rationale:** `01…` Q6 records it resolved; `22…` Preamble #5 states it as a hard constraint of the blueprint; `23…` REL-M2-T01 specifies the implementation and `23…` §15 Gate M2 and §16.2 gate on it. `21…` §12 also warns that retrofitting RTL after components exist is significantly more expensive — which is why this is settled before M2 rather than during it.
**Source:** `22…` Preamble #5; `23…` REL-M2-T01, REL-M2-T02, §15 Gate M2, §16.2; `01…` Q6.

### C.4 Confirmed stack (unchanged)
Next.js 14.2, TypeScript 5.4 `strict`, Tailwind 3.4, Drizzle ORM, iron-session 8, bcryptjs cost 12, Zod 3, file-type 19, sharp, sanitize-html, ulid, pino, `@sentry/nextjs` 8, node-cron, rate-limiter-flexible, `@aws-sdk/client-s3` + presigner, Vitest, testcontainers, Playwright, supertest, PM2, NGINX, Certbot.
**Source:** `21…` §11; `22…` §2.

### C.5 Sentry API surface
**Decision:** Use the v8 functional integration form `Sentry.postgresIntegration()`.
**Conflict resolved:** `23…` §12.3 uses `new Sentry.Integrations.Postgres()` (v7 style); `22…` §15.2 uses the v8 form. With `@sentry/nextjs` ^8 pinned in `22…` §2, only the functional form exists.
**Classification:** implementation detail. The scrubbing requirement in `23…` §12.3 — which is the substantive part — is unaffected and stands.

---

## D. Final database decisions

### D.1 Hosting — managed PostgreSQL in production, Docker locally
**Decision:**
- **Production and staging:** managed PostgreSQL 16 from an external provider (Neon recommended per `23…` §9.4), reached over a standard connection string.
- **Local development and CI:** Docker Compose PostgreSQL 16 (`22…` M0-T12) and testcontainers (`22…` M0-T03).
- **Self-managed PostgreSQL on the application VPS is not part of the design.**

**Conflict resolved:** `04…` §2, `15…` §3/§7.1 and `22…` §14.1 install PostgreSQL 16 on the VPS at `127.0.0.1:5432` with `sudo -u postgres psql`. `23…` §9.4, §13.2 and §16.6 require a managed provider and state that self-managed PostgreSQL on the VPS "is not acceptable — it creates a single host dependency for the primary data store."
**Rationale:** `23…` outranks 15 and 22 on infrastructure by its own declared scope. The reliability argument is documented and specific: SPOF-05 shows self-managed PG has no automatic failover and turns any VPS incident into a total data-availability loss with a 2-hour RTO, versus 30–90 s provider failover (`23…` §6.3 DR-03).

**Provider qualification checklist — verify before any schema work (M0-T01):**

| Requirement | Why | Source |
|---|---|---|
| PostgreSQL 16 | Schema targets 16 | `04…` §1 |
| `btree_gist` extension creatable | Exclusion constraint on `court_id` + range is the double-booking guarantee | `05…` §2; `21…` RC-001; `20…` R-TECH-001 |
| `EXCLUDE USING GIST … WHERE (status='approved')` accepted | Core integrity constraint | `05…` §4.9 |
| `GENERATED ALWAYS AS … STORED` columns | `booking_range` | `21…` RC-001 |
| Partial and composite indexes | `uq_court_name_per_venue_active`, `idx_bookings_admin_list` | `21…` RC-006, DBF-001 |
| `SERIALIZABLE` isolation | Booking creation and approval transactions | `04…` §6.2; `22…` §8.2, §8.4 |
| Role creation + `REVOKE` by the table owner | `app_user` cannot DELETE bookings/payments/proofs or UPDATE/DELETE audit_logs | `05…` §9; `22…` §4.4 |
| Automated backups + PITR | RPO targets | `23…` §6.2, §7.1 |
| `pg_dump`/`pg_restore` over the connection string | Supplementary daily backup to R2 | `23…` §7.2 |
| ≥ 60 connections | 2 instances × pool 10 + migrations + monitoring + buffer | `23…` §2.4 |

**If the chosen provider fails any row, escalate before proceeding — do not silently drop the constraint.** `20…` R-TECH-001's fallback ("application-level `SELECT FOR UPDATE` as the sole guard") is **rejected** by this record: `23…` §4.2 makes the exclusion constraint non-negotiable at all tiers. If a provider cannot support it, change providers.

**Knock-on corrections (implementation detail, not re-litigation):**
- `22…` §14.1 Step 3 (`sudo -u postgres psql` role creation) becomes provider-console or `psql "$DATABASE_MIGRATION_URL"` role setup.
- `23…` §6.3 DR-05 (`sudo -u postgres createdb`/`dropdb`) and §7.4 `verify-backup.sh` are rewritten against connection strings — restore target is a scratch database on the provider or a local Docker instance.
- `16…` §6.1 and `23…` §15.6 `postgresql.conf` edits (`log_min_duration_statement`) become provider dashboard settings.
- The `GRANT … ON ALL TABLES` in `22…` §4.4 runs **before** tables exist in the documented sequence. Add `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO app_user;` and re-apply the explicit `REVOKE`s **after** migrations. Without this, `app_user` has no rights on any table created later, and the audit-log REVOKE silently does nothing.

### D.2 `booking_range` — immutable representation (replaces RC-001's expression)

**Problem.** `05…` §4.9, `21…` RC-001 and `22…` §4.3/M0-T05 all specify:

```sql
booking_range TSTZRANGE GENERATED ALWAYS AS (
  tstzrange((booking_date + start_time) AT TIME ZONE 'Africa/Cairo',
            (booking_date + end_time)   AT TIME ZONE 'Africa/Cairo')
) STORED
```

PostgreSQL requires the generation expression of a stored generated column to be **IMMUTABLE**. The function behind `timestamp AT TIME ZONE text` (`timezone(text, timestamp)`) is **STABLE**, not immutable — its result depends on the installed timezone rules. PostgreSQL rejects this at `ALTER TABLE` time:

```
ERROR:  generation expression is not immutable
```

This blocks migration `0001_booking_integrity.sql` and therefore all of Milestone 0. No earlier review caught it.

**Decision — use an immutable `TSRANGE` over venue-local wall-clock time:**

```sql
-- src/db/migrations/raw/0001_booking_integrity.sql

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_range TSRANGE
  GENERATED ALWAYS AS (
    tsrange(booking_date + start_time, booking_date + end_time)
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

**Why this is immutable.** `date + time → timestamp` is the `datetime_pl` operator, marked IMMUTABLE — it is pure arithmetic with no timezone-rule dependency. `tsrange(timestamp, timestamp)` is likewise IMMUTABLE. No STABLE function appears in the expression, so PostgreSQL accepts it as a `STORED` generated column.

**Why it is equivalent for this system.**
1. `booking_date` (DATE) and `start_time`/`end_time` (TIME) already store **venue-local wall-clock values** — this is the existing schema in `05…` §4.9, unchanged. The venue operates in exactly one fixed timezone (`01…` A4; `venues.timezone = 'Africa/Cairo'`).
2. For a single venue in a single timezone, two slots overlap in absolute time **if and only if** they overlap in wall-clock time. Court occupancy is a wall-clock fact: staff, customers and the printed schedule all reason in local time.
3. Range semantics are unchanged. `&&` on `tsrange` detects full overlap, partial overlap and containment, and treats adjacent ranges (`18:00–19:00`, `19:00–20:00`) as **non**-overlapping — exactly as required by `05…` §4.9 and asserted by the tests in `22…` §12.3 and `14…` §4.3.
4. **DST behaviour is strictly safer.** Egypt observes DST. At the autumn transition one wall-clock hour occurs twice in absolute time. A `tstzrange` would treat those as two distinct bookable instants; `tsrange` treats them as one slot and refuses the second approval. The wall-clock reading matches operational reality (one court, one 23:00 booking) and is more conservative on the axis that matters — it can only ever prevent a double booking, never permit one.
5. `AT TIME ZONE` conversion is not lost, only relocated. Presentation-layer and cross-timezone conversion continue to use `Africa/Cairo` in application code, as `22…` §8.1 and §8.6 already require (`getDayOfWeekInCairo`).

**Why not the alternative.** Adding application-written `start_at`/`end_at TIMESTAMPTZ` columns and generating `tstzrange(start_at, end_at)` is also immutable, but it introduces two denormalised columns that the application must keep synchronised with `booking_date`/`start_time`/`end_time`, creating a drift path that can silently disable the constraint. `tsrange` requires zero new writable columns and zero application responsibility. Smallest change that preserves the guarantee.

**What does not change:** the column name `booking_range`, the constraint name `no_overlapping_approved_bookings`, the `court_id WITH =` + `range WITH &&` shape, the `WHERE (status = 'approved')` predicate, the `btree_gist` dependency (still required — `court_id` is UUID, not a range type), and the `23P01` error mapping to HTTP 409.

**Consequential edits (implementation detail):**
- `22…` §8.2 step 7a and §8.4's conflict query must build `tsrange(date + startTime, date + endTime)`, not `tstzrange(… AT TIME ZONE …)`.
- `22…` §19 DoD wording "`booking_range TSTZRANGE …` column present" reads TSRANGE. `23…` §16.3's check — `information_schema.columns … column_name = 'booking_range'` — asserts no type and passes unchanged.
- `23…` REL-M3-T05's timezone test "`booking_range` produces correct TSTZRANGE using `AT TIME ZONE`" is rewritten to assert wall-clock range correctness and adjacency. All other timezone tests in that task stand unchanged and remain required.

**M0 verification (blocking).** Before declaring M0-T05 done, run the constraint against the real provider:
```sql
-- must succeed
INSERT INTO bookings (... status) VALUES (..., '2026-09-10','19:00','20:00','approved');
-- must fail with SQLSTATE 23P01
INSERT INTO bookings (... status) VALUES (..., '2026-09-10','19:00','20:00','approved');
-- must succeed (adjacent, not overlapping)
INSERT INTO bookings (... status) VALUES (..., '2026-09-10','20:00','21:00','approved');
```

### D.3 Required Changes RC-001…RC-007 remain binding
RC-001 as amended by §D.2 above; RC-002 (non-blocking upload); RC-003 (`venues.booking_ref_prefix`); RC-004 (documented pending-booking race, tested not "fixed"); RC-005 (`chk_booking_date_future` removed, validated in the service layer); RC-006 (`uq_court_name_per_venue_active` partial unique index); RC-007a (`payment_proof_viewed` enum value); RC-007b (`must_change_password`); plus advisory `idx_bookings_admin_list`.
**Source:** `21…` §3, §10; `22…` M0-T04, M0-T05.

### D.4 Seed contents — empty of business data
**Decision:** The production seed creates exactly: one `venues` row, three `admin_roles`, all `admin_role_permissions` rows, one super-admin from `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` with `must_change_password = true`. **No** operating hours, courts, pricing rules, or CMS content. Idempotent via `ON CONFLICT DO NOTHING`.
**Conflict resolved:** `18…` M0 specifies seeding "one venue, 2 courts, operating hours, pricing rules, super_admin". That is **stale** — it predates the OBD framework.
**Rationale:** `22…` §4.5 and Preamble #6 forbid inventing business values while OBD-004 is unresolved; `23…` §15 Gate M2 gates on the absence of seeded hours.
**Addition:** a separate, clearly-labelled **development-only** fixture (`tests/fixtures/seed-test-db.ts`, plus an optional `db:seed:dev` script) supplies courts, hours and pricing for local work and tests. It must never run against staging or production.
**Source:** `22…` §4.5, §4.6, M0-T06, M0-T03; `23…` §15 Gate M2.

### D.5 Court photos — dedicated `court_images` table (Option B)

**Decision: Option B.** Add one small table. Do **not** add `entity_type`/`entity_id` to `cms_gallery_items`.

```sql
CREATE TABLE court_images (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id      UUID NOT NULL REFERENCES courts(id) ON DELETE RESTRICT,
    storage_key   VARCHAR(500) NOT NULL,
    alt_text      VARCHAR(255),
    display_order INTEGER NOT NULL DEFAULT 0,
    uploaded_by   UUID REFERENCES admin_users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ
);
CREATE INDEX idx_court_images_court ON court_images(court_id) WHERE deleted_at IS NULL;
```

**Why not Option A:**
1. **Referential integrity.** A polymorphic `entity_id` cannot carry a foreign key. `03…` NFR-DATA-006 requires FK constraints for all relationships. Option B satisfies it; Option A cannot.
2. **Module boundaries.** `04…` §3/§10 and `22…` §1.3 forbid one module querying another's tables. Court photos are court data; `cms_gallery_items` is owned by the `cms` module. Option A forces either `courts → cms` table access (a boundary violation) or the CMS module owning court concerns.
3. **Query safety.** `cms_gallery_items` already has live readers — the public gallery page and `cms.getGalleryItems()` (`09…` §4.1, `22…` §10.3). Option A silently changes their result set and requires adding `WHERE entity_type IS NULL` to every existing and future gallery query. Every missed call site leaks court photos into the public gallery. Option B changes no existing query.
4. **Storage layout already separates them.** `12…` §3 defines `courts/{courtId}/{ulid}.{ext}` as distinct from `cms/gallery/{ulid}.{ext}`. Option B matches the storage design; Option A contradicts it.
5. **`alt_text` is required, `caption`/`category` are not.** `03…` NFR-ACC-003 requires meaningful alt text on all images. Court images need alt text; they do not need the gallery's `category`, `caption` or `is_published` (visibility follows the court's own `is_active`). Option A would attach four irrelevant nullable columns to court photos and one irrelevant pair to every gallery row.

**Cost:** one table, ~8 columns. That is smaller in real terms than retrofitting polymorphism into a table with existing consumers.
**Requirements served:** FR-ADM-040, FR-ADM-044 (P2), FR-CUS-030 (`02…`); admin form in `08…` §5.2; public cards in `22…` M2-T07.
**Corrects:** `22…` §11.5's "gallery-type entries with `entity_type = 'court'`" — the referenced columns do not exist in `05…` §4.15 and are hereby not created.
**Milestone:** table defined in M0-T04 with the rest of the schema; upload UI in M5-T01; public rendering in M2-T07.

### D.6 Customer account model
**Decision:** Table name is **`customer_accounts`** exactly as defined in `05…` §4.8. `22…` §3 and §4.2 refer to it as `customers`; the schema file is `src/db/schema/customer-accounts.ts` and the module directory remains `src/modules/customers/` (module name ≠ table name).
**Addition:** add `deleted_at TIMESTAMPTZ` to `customer_accounts`. `05…` §7 promises "Customer records — soft-delete on explicit request" but the table has no column to express it, and `03…` NFR-DATA-004 mandates soft deletion. One nullable column, added at M0 rather than as a later migration against populated data.
**Note:** the partial unique index on `phone_number` (`05…` §4.8) means a customer entering a phone already held by another account will hit a constraint violation. Required handling: return a field-level validation error ("This phone number is already registered to another account"), never a 500. Recorded as an implementation detail for M1/M3, not a schema change.

### D.7 Booking slot boundary — `24:00` is valid
See §F.4. `end_time` may be `'24:00:00'`; `booking_date + '24:00'::time` yields next-day 00:00, which is the correct upper bound of the final slot, and `chk_booking_time_range CHECK (start_time < end_time)` holds. No schema change required — only the API regex changes.

---

## E. Final authentication / RBAC decisions

### E.1 Customer identity — authenticated accounts and session-derived ownership only

**Decision:** Booking ownership is **always** derived from `session.customerId`. Phone number is contact data. It is **never** an identity, lookup, or authorisation mechanism.

**Obsolete — do not implement:**

| Obsolete concept | Source | Status |
|---|---|---|
| `customers` module described as "phone-based identity" | `04…` §3 | **Obsolete** |
| `INSERT customer (upsert on phone)` in the booking transaction | `04…` §4 step 4e | **Obsolete** — replaced by "confirm/update the authenticated account's profile" (`22…` §8.2 step 7b) |
| `INSERT INTO customers (upsert on phone)` | `07…` §4 | **Obsolete** |
| `POST /api/v1/bookings/proof` body `{reference, phone, paymentProof}` | `11…` §4.5 | **Obsolete** — the request carries `{reference, paymentProof}`; ownership comes from the session (`10…` §3.4; `22…` §9.1 step 4) |
| `findByReferenceAndPhone(ref, phone) // customer identity check` | `22…` M3-T09 | **Obsolete** — replaced by `findByReferenceAndCustomerAccount(ref, customerAccountId)` (`22…` §6.3) |
| "All bookings associated with this phone number" | `08…` §8 | **Obsolete** — admin customer detail joins on `bookings.customer_account_id` |
| Anonymous reference + phone status lookup | any | **Obsolete** — "There is no anonymous reference + phone fallback" (`10…` §1) |

**Authoritative:** `05…` §4.8; `10…` §1, §3.2–3.5; `11…` §4.3 step 9; `19…` AC-CUS-009, AC-CUS-010; `22…` §6.3, §8.1; `23…` REL-M1-T01, REL-M3-T01.
**Enforcement:** `customer_account_id` is absent from every request schema. A `customerId`, `customerAccountId` or equivalent field in a request body has no effect (`23…` §16.4).

### E.2 Google OAuth — `arctic`

**Decision:** Implement Google Sign-In with **`arctic`** (`^3`), a dependency-light OAuth 2.0 client. No NextAuth. No Lucia. No `openid-client`.

**Why `arctic`:**
- It is an OAuth client only — it issues no cookies, owns no session, and imposes no database schema. That is precisely the constraint: `22…` §2 excludes NextAuth/Lucia, and `10…` §3.1 requires the session to remain iron-session encrypted cookies with a separate cookie namespace.
- It ships a `Google` provider with authorization-URL construction, PKCE, and code exchange — the parts that are risky to hand-roll — and nothing else.
- Alternative considered: `google-auth-library` (vendor-official). Functionally adequate and acceptable as a fallback, but it is a broader SDK oriented toward service-account and API-client use; `arctic` is the smaller surface for a plain sign-in redirect. Alternative rejected: hand-rolled `fetch` against Google's endpoints — it puts state/PKCE/nonce correctness on us for no dependency saving.

**Required flow (preserves the documented architecture):**
1. `GET /api/v1/auth/google/start` — **GET navigation, not a form POST.** Generate `state` + PKCE `code_verifier`, store both in a short-lived signed cookie, 302 to Google. (A form POST would interact with the `form-action 'self'` CSP directive in `22…` §6.5; a GET redirect does not, so **no CSP change is needed**.)
2. `GET /api/v1/auth/google/callback` — validate `state`, exchange the code, read the `id_token` returned directly from Google's token endpoint over TLS in a server-to-server call. Signature verification may be skipped for tokens obtained this way, per Google's own guidance; if the team prefers belt-and-braces, verify with JWKS.
3. Upsert `customer_accounts` on `google_id`, then on `email`. Create the iron-session `thefield_customer_session` (`10…` §3.1).
4. Redirect target: **only** a same-origin relative path from an allowlist. Never reflect an absolute URL. The registered redirect URI is a single fixed value.
**Source:** `10…` §3.1; `22…` §2, §6.3; `23…` REL-M1-T01, REL-M2-T04, §16.4 (open-redirect test).

**Environment variables — add to `.env.example`** (missing from `22…` §14.2, which is a documented gap): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. Required at startup once M1 lands (`23…` REL-M1-T04).

### E.3 Sessions
Unchanged. Admin: `thefield_admin_session`, `HttpOnly; Secure; SameSite=Lax; Path=/admin`, 8 h, revocation via `sessions_invalidated_at` checked on every protected request. Customer: `thefield_customer_session`, `Path=/`, 7 days. Same `SESSION_SECRET` on every instance so sessions survive instance switching.
**Source:** `10…` §2.3–2.4, §3.1; `22…` §6.2; `23…` §11.3, REL-M1-T02.

### E.4 CSRF — `SameSite=Lax` + `Content-Type` + form token
**Decision:** `SameSite=Lax` is the primary control; all admin mutations require `Content-Type: application/json`; the customer booking form carries a CSRF token. **`X-Requested-With` is not used and must not be added.**
**Conflict resolved:** `13…` T-003 lists `X-Requested-With` as a mitigation. `10…` §5.4 explicitly rejects it, and `21…` ISSUE-012/SF-005 orders its removal — but the review's appendix only flagged Doc 10 (already corrected) and missed Doc 13. `13…` T-003 is **stale**.
**Rationale (from `10…` §5.4):** `fetch()` does not send the header automatically, and proxies strip custom headers — so it produces false failures without adding real protection.

### E.5 Final permission matrix

Two inconsistencies resolved:

**(a) `viewer` holds `manage_customers`.** `10…` §4.2 and `22…` §7.3 grant a read-only role a permission that gates the mutating `PATCH /api/v1/admin/customers/{id}` (`11…` §5.7, `08…` §8 "admin can add internal notes"). Note the permission's own definition in `05…` §4.12 is *"View and search customers"* — read-only. One permission is doing two jobs.
**Resolution:** split into `view_customers` (list, search, detail) and `manage_customers` (edit notes). `viewer` receives `view_customers` only. This preserves `10…` §4.2's stated intent ("can view bookings, customers, audit logs") while closing the write path. Adds one permission string; no schema change (`admin_role_permissions` is already a free-form string table).

**(b) `/review` gated on a read permission.** `22…` §5.4 and §11.4 gate `POST /admin/bookings/[id]/review` — a state transition to `under_review` — on `view_bookings`.
**Resolution:** `/review` requires `view_bookings` **AND** `approve_booking`. No new permission needed: `super_admin` and `admin` hold `approve_booking`; `viewer` does not — which yields exactly the intended outcome that a read-only role cannot mutate booking state. Marking a booking under review is a step in the approval workflow, so `approve_booking` is the semantically correct gate.

**Final permission set (16):**

| Permission | super_admin | admin | viewer |
|---|:--:|:--:|:--:|
| `view_bookings` | ✓ | ✓ | ✓ |
| `approve_booking` | ✓ | ✓ | — |
| `reject_booking` | ✓ | ✓ | — |
| `cancel_booking` | ✓ | ✓ | — |
| `verify_payment` | ✓ | ✓ | — |
| `reject_payment` | ✓ | ✓ | — |
| `view_payment_proof` | ✓ | ✓ | ✓ |
| `manage_courts` | ✓ | ✓ | — |
| `manage_pricing` | ✓ | ✓ | — |
| `manage_schedule` | ✓ | ✓ | — |
| `view_customers` **(new)** | ✓ | ✓ | ✓ |
| `manage_customers` | ✓ | ✓ | — |
| `manage_cms` | ✓ | ✓ | — |
| `manage_admins` | ✓ | — | — |
| `view_audit_logs` | ✓ | ✓ | ✓ |
| `manage_settings` | ✓ | ✓ | — |

**Route → permission map (amendments to `22…` §5.4 only):**

| Route | Permission |
|---|---|
| `POST /admin/bookings/[id]/review` | `view_bookings` + `approve_booking` |
| `GET /admin/customers`, `GET /admin/customers/[id]` | `view_customers` |
| `PATCH /admin/customers/[id]` | `manage_customers` |
| `POST /admin/bookings/[id]/payment/reject` **(new — §G.1)** | `reject_payment` |

Every other row of `22…` §5.4 stands unchanged.
**Invariant:** permission checks are server-side at the service layer on every mutation. Hiding UI controls is cosmetic only (`22…` §7.2; `10…` §4.3).

---

## F. Final booking / state-machine decisions

### F.1 Concurrency model — unchanged and non-negotiable
Two layers: `SERIALIZABLE` transaction with `SELECT … FOR UPDATE` overlap check, plus the database exclusion constraint as the final guard, with `23P01` mapped to HTTP 409. The constraint is never weakened, disabled, or made conditional.
**Source:** `04…` §6.2; `06…` §9; `22…` §8.2, §8.4; `23…` §4.2.

### F.2 The pending-booking race stays documented and tested, not "fixed"
Two concurrent requests may each create a `pending` booking for the same slot. Both soft-hold it; only one can ever reach `approved`; the admin rejects the other. Adding a constraint on non-approved statuses is explicitly rejected as causing more operational harm than the race.
**Source:** `06…` §5; `21…` ISSUE-005, RC-004; `22…` §8.5.

### F.3 Booking reference — Cairo business date, built from the validated date string

**Decision:** `generateBookingReference(prefix: string, bookingDate: string /* 'YYYY-MM-DD' */)`. The date component is taken directly from the already-validated request date string, which **is** the Cairo business date by definition. No `Date` object, no `toISOString()`, no timezone conversion anywhere in reference generation.

**Conflict resolved:** `22…` §8.7 uses `date.toISOString().slice(0,10)` — UTC — which contradicts `22…` §8.1 rule 5 ("all date/time math happens in Africa/Cairo") and yields an off-by-one reference for evening bookings.
**Rationale:** removing the `Date` round-trip eliminates the entire bug class rather than patching it; it is also strictly less code. If a `Date` must be formatted elsewhere, use `Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' })`.
**Unchanged:** format `{prefix}-YYYYMMDD-XXXX`, prefix from `venues.booking_ref_prefix`, 4-char suffix from the 32-character alphabet excluding `0/O/I/1`, regenerate-and-retry once on unique violation.
**Source:** `05…` §5; `21…` RC-003; corrects `22…` §8.7.

### F.4 Slot time format — `24:00` permitted as an end time

**Problem (new finding).** `11…` §6 and `22…` §8.2 specify `endTime: z.string().regex(/^([01]\d|2[0-3]):00$/)` — maximum `23:00`. But `01…` Q8's default operating assumption is 08:00–24:00, and `22…` M3-T04 states the closing slot is expressed as `close_time = '24:00'`. Under the documented regex, **the 23:00–24:00 slot can be displayed by the availability endpoint but never booked** — every submission fails validation with a 400.

**Decision:**
- `startTime` regex unchanged: `/^([01]\d|2[0-3]):00$/` (00:00–23:00).
- `endTime` regex becomes `/^([01]\d|2[0-3]|24):00$/`.
- Cross-field rule (service layer, `22…` §8.2 step 5a): `endTime` must equal `startTime` + 1 hour. This preserves the V1 single-hour-slot rule (`01…` A3, Q1) and prevents `24:00` being paired with anything but `23:00`.
- No schema change: PostgreSQL `TIME` accepts `'24:00:00'`; `chk_booking_time_range CHECK (start_time < end_time)` holds; `booking_date + '24:00'::time` correctly yields next-day 00:00 as the range's upper bound (§D.2).

**Required test:** book 23:00–24:00 on a venue closing at midnight; assert 201, a correct `booking_range`, and that it does not overlap 22:00–23:00 the same night or 00:00–01:00 the next morning. Add to the M3 double-booking suite.
**Source:** `22…` M3-T04; `01…` Q8; `05…` §4.4, §4.9; corrects `11…` §6 and `22…` §8.2 step 4.

### F.5 `expires_at` lifecycle
**Decision:** set at creation to `NOW() + BOOKING_EXPIRY_MINUTES`; **left unchanged** on `pending → payment_submitted`; cleared (`NULL`) on approval; **reset** to a fresh window when an admin rejects a payment and returns the booking to `pending` (§G.1).
**Rationale:** `21…` ISSUE-011 left this advisory. Leaving the value in place is harmless because the expiry job filters on `status = 'pending'` (`06…` §8), and it preserves the original creation deadline for audit. The reset in the payment-rejection path is required — without it a returned booking would be expired by the next cron run.
**Source:** `05…` §4.9; `06…` §8; `22…` §8.4; resolves `21…` ISSUE-011.

### F.6 Expiry job scope
Only `pending` bookings past `expires_at` expire. `payment_submitted` and `under_review` never auto-expire (OBD-005). Every expired booking produces exactly one `booking_expired` audit row.
**Source:** `06…` §8; `22…` §8.3; `23…` §16.6.

---

## G. Final payment decisions

### G.1 Payment rejection vs booking rejection — two distinct actions

**Contradiction.** `06…` §6 and `07…` §7.3 promise that a customer whose proof is rejected (blurry, illegible) can re-upload and re-enter the review queue — `06…` line 137 even conditions the payment `rejected → submitted` transition on the booking "still not `rejected`/`expired`". But `07…` §6.4, `08…` §4.4 and `22…` §5.4 implement rejection as one action that sets **both** `bookings.status = 'rejected'` (terminal, slot released) and `payment_records.status = 'rejected'`. There is therefore no reachable re-upload path. Separately, `reject_payment` exists as a permission (`05…` §4.12) and FR-PAY-008/FR-ADM-024 require the capability, but **no API route implements it** (`11…` §5.2).

**Decision — split the action. No new enum values, no new tables, no new audit actions.**

**Action 1 — Reject payment (recoverable).** `POST /api/v1/admin/bookings/{id}/payment/reject`, permission `reject_payment`, body `{ reason: string }`. Permitted from booking `payment_submitted` or `under_review`. In one transaction:
- `payment_records`: `status = 'rejected'`, `rejected_by`, `rejected_at`, `rejection_reason`.
- `bookings`: `status = 'pending'`, `expires_at = NOW() + BOOKING_EXPIRY_MINUTES`.
- `audit_logs`: one `payment_rejected` row with metadata `{ previousBookingStatus, newBookingStatus: 'pending', newExpiresAt, reason }`.

The slot stays soft-held. The customer sees the rejection reason on `/booking-status` and re-uploads, which follows the **already-documented** `pending → payment_submitted : customer` transition and the `rejected → submitted` payment transition. If they do not re-upload in time, the existing expiry job releases the slot — no indefinite hold.

**Action 2 — Reject booking (terminal).** `POST /api/v1/admin/bookings/{id}/reject`, permission `reject_booking`, unchanged: `bookings.status = 'rejected'` (terminal), payment marked rejected, slot released immediately. **No transition out of `rejected` exists for any actor.** A finalised rejection can never become approved.

**State-machine delta — exactly two entries added to `ALLOWED` (`22…` §8.5):**
```
'payment_submitted→pending:admin'
'under_review→pending:admin'
```
Both are reachable only through the `reject_payment`-gated route. Every terminal state remains terminal.

**Why this is the smallest change:** it adds no enum value (`payment_rejected` already exists in `audit_action`, `05…` §4.14), no table, no column, and no new booking status. It reuses the documented `pending → payment_submitted` customer transition and the documented `rejected → submitted` payment transition. It implements a permission and two functional requirements that currently have no code path. It preserves full auditability — the payment's rejection reason and the booking's status history both survive.

**Admin UI:** the rejection dialog (`07…` §6.4, `22…` §11.4) gains an explicit choice — *"Reject payment — ask customer to re-upload"* versus *"Reject booking — final"* — with the predefined reason list retained. Blurry/illegible/wrong-amount map naturally to the first; fraudulent/duplicate to the second.
**Tests (M4):** payment rejection returns the booking to `pending` with a fresh `expires_at`; the customer can re-upload and reach `payment_submitted`; a booking-rejected booking cannot be approved, re-uploaded to, or transitioned by any actor; a `viewer` gets 403 on both routes.
**Source:** `06…` §6; `07…` §7.3; `05…` §4.12, §4.14; `02…` FR-PAY-008, FR-PAY-012, FR-ADM-024; resolves the conflict with `07…` §6.4, `08…` §4.4, `22…` §5.4.

### G.2 Manual verification is absolute
No automatic payment verification exists or may be added. Payment status is never accepted from any client. Approval requires `approve_booking` **and** `verify_payment` and re-validates availability inside the transaction.
**Source:** `01…` C2; `02…` FR-PAY-009; `07…` §1; `13…` T-009; `21…` SF-001.

### G.3 Upload remains non-blocking, with existence verification
Booking creation commits first; upload is best-effort afterwards; the reference is always returned. `storageService.exists(key)` must confirm the object before the `payment_proofs` row is written; on failure the row is not written and the booking stays `pending`.
**Source:** `21…` RC-002; `22…` §8.2 step 8, §9.1; `23…` REL-M4-T01, FM-07.

### G.4 InstaPay number
From CMS key `venue.instapay_number`. If empty, the payment step shows a warning and **submission is disabled**. No placeholder or example number anywhere in code, seed, or fixtures.
**Source:** `07…` §9; `22…` §10.2, §10.5; `23…` §15 Gate M2, §16.1.

---

## H. Final storage decisions

### H.1 Cloudflare R2 in production; local disk is development-only
**Decision:** `STORAGE_PROVIDER=s3` in staging and production against Cloudflare R2 — `thefield-private` (proofs), `thefield-public` (media), `thefield-backups` (dumps). `STORAGE_PROVIDER=local` is development-only and must never be set in staging or production. No persistent customer or CMS file may live on the VPS disk.
**Conflict resolved:** `12…` §2.1 Option D presents local disk as an acceptable fallback and `20…` R-TECH-004 treats it as a temporary option. `23…` §1.3 and §16.6 make VPS-local persistent files a launch blocker.
**Source:** `12…` §2; `23…` §1.3, §13.2, §16.6; `00-index.md` key decisions.

### H.2 Access model unchanged
Private bucket with no public policy; proofs reachable only through a 5-minute presigned URL issued after session + `view_payment_proof` + venue-scope IDOR check, with every view written to `audit_logs` as `payment_proof_viewed`. Public bucket for `courts/` and `cms/`. All keys ULID-generated server-side; client filenames never enter a key. Proofs ≤10 MB, JPEG/PNG/PDF by magic bytes, SVG explicitly rejected. CMS images ≤5 MB, resized to 2000 px and converted to WebP.
**Source:** `12…` §3–§7; `22…` §9.2, §9.4–9.5; `13…` T-010, T-011.

---

## I. Final infrastructure / reliability decisions

### I.1 Deployment tier
Tier 2 from day one: Cloudflare (DNS, TLS, WAF, CDN, DDoS, cache bypass on `/api/*`, `/admin/*`, `/booking-status`) → Hostinger KVM 2 VPS (2 vCPU / 8 GB / 100 GB, Amsterdam) running NGINX + two PM2 instances → managed PostgreSQL → R2. Tier 3 only on measured triggers.
**Conflict resolved:** `20…` §6 calls Cloudflare "strongly recommended but not strictly required"; `23…` §13.2 makes it required at launch. `23…` governs.
**Source:** `23…` §10, §13.1–13.3.

### I.2 Two PM2 instances — and why the expiry job is safe on both

**Decision:** two `fork`-mode instances on ports 3000 and 3001 from the first deployment, both running the node-cron expiry job. `exec_mode: 'fork'`, `kill_timeout: 35000`, `listen_timeout: 5000`.
**Conflict resolved:** `15…` §5 and `22…` §14.4 specify `instances: 1` *because* node-cron is in-process; `17…` §5 says cron must be disabled on all but one instance. Both are **stale** — `23…` §1.4 supplies the analysis that makes a single instance unnecessary.

**Why running the job twice is safe.** The job is one statement:

```sql
UPDATE bookings SET status = 'expired', updated_at = NOW()
WHERE status = 'pending' AND expires_at < NOW()
RETURNING id, booking_reference;
```

1. Both instances start the statement. Instance A acquires row locks first and commits.
2. Instance B blocks on each contended row. Under **READ COMMITTED**, when a blocked `UPDATE` acquires the lock it **re-evaluates the `WHERE` clause against the newly committed row version**. Those rows are now `status = 'expired'`, so they no longer qualify and are silently skipped.
3. Consequently each booking is expired exactly once, and only the winning transaction receives it in `RETURNING`.
4. Audit rows are written **from the `RETURNING` set only**. Instance B returns zero rows and writes zero audit rows — no duplicate `booking_expired` entries.

**Mandatory conditions:**
- The expiry job runs at the **default READ COMMITTED** isolation, not the serializable helper. Under `SERIALIZABLE` one instance would abort with a serialization failure (`40001`) and log a spurious error. `22…` M1-T01 already reserves `serializable` for booking transactions and read-committed for everything else — the expiry job is explicitly in the latter group.
- Audit writes derive strictly from `RETURNING`; never from a separate `SELECT`.
- No `job_locks` table in V1. It is a Tier 3 addition.

**Cost:** one redundant query every 15 minutes, matching zero rows. Negligible.
**Verification:** `23…` §15 Gate M6 — "run the expiry job simultaneously from both instances; verify the audit log contains the correct expiry count, not double."
**Source:** `23…` §1.4, §4.5, REL-M0-T01; supersedes `15…` §5, `22…` §14.4, `17…` §5.

### I.3 Health endpoints — `/api/health/ready` is the UptimeRobot target
**Decision:** UptimeRobot's primary monitor is **`/api/health/ready`** (DB-backed). `/api/health/live` is for PM2/NGINX and process-liveness checks. `/api/health` is retained as a combined backward-compatible alias.
**Conflict resolved:** `16…` §3.1 and `11…` §5.13 monitor `/api/health`; `23…` §16.8 specifies `/api/health/ready`. `23…` governs; `16…` is stale on the target but its alerting rules stand.
**Operational note:** `/api/health/ready` returns 503 during graceful shutdown (`23…` §13.5), so a rolling deploy can produce a transient failed probe. Configure UptimeRobot with a 5-minute interval **and confirmation retries** so a deploy does not page the venue owner. Recorded as an implementation detail for M6.
**Source:** `23…` §1.5, §12.2, §16.8.

### I.4 `BOOKING_EXPIRY_MINUTES` has no default
**Decision:** OBD-002 is unresolved. `src/lib/config.ts` throws at module load if the variable is unset, on **every** environment. `.env.example` ships it blank with an OBD-002 comment. Developers set a local value in `.env.local`; that value carries no business meaning and is never copied to staging or production.
**Conflict resolved:** `15…` §6 shows `BOOKING_EXPIRY_MINUTES=120` as an environment default; `01…` Q4 and `04…` §6.3 mention "2 hours" as a provisional assumption. All are **stale** against `22…` Preamble #4 / §4.6 and `23…` §13.8 rule 8.
**Source:** `22…` §4.6, §7.4, M0-T07; `23…` §13.8, REL-M1-T04.

### I.5 Client IP behind Cloudflare — `real_ip` module required (new finding)

**Problem.** `22…` §5.6 and M1-T11 extract the rate-limit key from `X-Real-IP`, "set by NGINX (`proxy_set_header X-Real-IP $remote_addr`)". With Cloudflare proxying in front (`23…` §1.1, §13.2), `$remote_addr` is a **Cloudflare edge IP**, not the visitor's. Every visitor would therefore share one of a few dozen rate-limit buckets — availability checks would 429 across the whole site within seconds of launch, and per-IP brute-force protection would be meaningless. No document currently configures `ngx_http_realip_module`.

**Decision — required in `nginx/thefield.conf` from M0:**
```nginx
# Restore the visitor IP from Cloudflare
set_real_ip_from <each Cloudflare IPv4/IPv6 range>;   # cloudflare.com/ips
real_ip_header   CF-Connecting-IP;
real_ip_recursive on;
```
With this in place `$remote_addr` becomes the true client IP, so the existing `proxy_set_header X-Real-IP $remote_addr` lines, all `limit_req_zone $binary_remote_addr` zones, and the application's `X-Real-IP` extraction all work as documented — **no application code change**. `CF-Connecting-IP` must never be trusted from a source outside the allowlisted ranges.
**Verification (M0/M6):** submit requests from two distinct client IPs through Cloudflare and confirm the NGINX JSON access log records distinct `ip` values; confirm rate limits apply per visitor, not globally.
**Source:** `23…` §1.1, §13.2 (Cloudflare required) + `22…` §5.6, §14.5, `15…` §4 (IP extraction assumption). Classified in §K as an infrastructure gap, not a contradiction.

### I.6 Final rate-limit key strategy

**Conflict resolved:** `11…` §4.4 and `13…` T-013 key booking-status limits "per customer account"; `11…` §7 and `22…` §5.6 key everything by IP. `10…` §3.1 requires customer-login brute-force protection that appears in no rate-limit table.
**Resolution:** IP for unauthenticated endpoints; **both** IP and account for authenticated endpoints, with both checks required to pass. IP alone cannot stop one account rotating addresses; account alone cannot stop distributed pre-auth abuse.

| Endpoint | Primary key | Secondary key | Limit | Source |
|---|---|---|---|---|
| `POST /api/v1/auth/login` (customer) | IP | email | 5 / 15 min per IP; 10 / hour per email | `10…` §3.1; new secondary — gap filled |
| `POST /api/v1/auth/register` (customer) | IP | — | 5 / hour | new — gap filled |
| `POST /api/v1/bookings` | IP | customerAccountId | 10 / hour each | `11…` §7 + `13…` T-013 principle |
| `POST /api/v1/booking-status` | customerAccountId | IP | 10 / 10 min per account; 30 / 10 min per IP | `11…` §4.4, `13…` T-013 (primary); `11…` §7 (secondary) |
| `GET /api/v1/customer/bookings` | customerAccountId | IP | same as booking-status | `11…` §4.4a |
| `POST /api/v1/bookings/proof` | IP | customerAccountId | 5 / hour each | `11…` §7 |
| `GET /api/v1/availability` | IP | — | 60 / min | `11…` §7 |
| `GET /api/v1/courts`, public CMS reads | IP (NGINX `general` zone) | — | 120 r/m | `15…` §4; `22…` §14.5; resolves `21…` ISSUE-008 |
| `POST /api/v1/admin/auth/login` | IP | — | 5 / 15 min, 15 min block (NGINX + app) | `10…` §2.6; `11…` §7 |
| All other admin routes | adminId | — | 120 / min | `11…` §7 |

**NGINX `general` zone is 120 r/m.** `13…` T-017's `rate=60r/m` snippet is illustrative and stale against the actual configs in `15…` §4 and `22…` §14.5.
**Exceeding any limit returns `apiError('RATE_LIMITED', 429)` — never an unhandled exception** (`22…` §5.6).
**Storage:** `RateLimiterMemory` in V1; `RateLimiterRedis` at Tier 3 (`23…` §1.3, SPOF-08).
**Depends on §I.5** — none of these keys are meaningful until the real-IP configuration is in place.

### I.7 Graceful shutdown, pool, and load-balancer safety
SIGTERM → `isShuttingDown = true` → `/api/health/ready` returns 503 → 30 s drain → `pool.end()` → exit 0, with PM2 `kill_timeout: 35000`. Pool: max 10 per instance, min 2, 5 s connection timeout, 30 s statement timeout, `pool.on('error')` to Sentry + pino. `proxy_next_upstream off` on `/api/v1/bookings` — a retried mutation could create a duplicate booking.
**Source:** `23…` §1.6, §2.4, §13.5, REL-M0-T03, REL-M0-T04.

---

## J. Final testing decisions

### J.1 Non-negotiable suites
All ten double-booking integration tests (`22…` §12.3), price manipulation, IDOR across two authenticated accounts, upload security (PHP-as-JPEG, SVG, 11 MB), expiry-job scope, direct-SQL `23P01`, admin idempotency, multi-instance concurrency, DB-failure 503, storage-failure, timezone, RTL E2E on 390 px, unauthorised-access E2E.
**Source:** `14…`; `22…` §12; `23…` §14–15.

### J.2 Tests added by this record
| Test | Reason | Milestone |
|---|---|---|
| `booking_range` is TSRANGE, generated, and the constraint rejects overlap with `23P01` | §D.2 | M0 |
| 23:00–24:00 slot bookable; no false overlap with 22:00–23:00 or next-day 00:00–01:00 | §F.4 | M3 |
| Booking reference date matches the Cairo business date for a 23:00 booking | §F.3 | M3 |
| Payment rejection → `pending` with fresh `expires_at` → customer re-upload → `payment_submitted` | §G.1 | M4 |
| A `rejected` booking cannot be approved, re-uploaded to, or transitioned by any actor | §G.1 | M4 |
| `viewer` receives 403 on `/review`, `PATCH /admin/customers/{id}`, and both reject routes | §E.5 | M5 |
| Two distinct client IPs through Cloudflare produce distinct rate-limit buckets | §I.5 | M0 / M6 |
| Booking body containing `customerAccountId` does not change booking ownership | §E.1 | M3 |

### J.3 Coverage targets unchanged
State machine 100% branch; conflict detector 100% branch; price calculator ≥95%; booking/payment services ≥85%; permissions ≥90%; routes ≥75%; overall ≥70%.
**Source:** `22…` §12.5; `14…` §7.

---

## K. Resolved contradictions

Classification: **Resolved** (decision made here) · **Stale** (older doc superseded) · **Impl** (implementation detail) · **Owner** (business decision required) · **Blocker** (must clear before M0 completes).

| # | Issue | Classification | Resolution | §
|---|---|---|---|---|
| S1 | Generated column not immutable — migration fails | **Blocker → Resolved** | Immutable `TSRANGE`; constraint shape unchanged | D.2 |
| S2 | Self-managed vs managed PostgreSQL | **Resolved** | Managed in prod/staging; Docker locally; provider checklist | D.1 |
| S3 | Milestone order (18/21 vs 22/23) | **Resolved** | 22/23 sequence governs | N |
| S4 | Seed contents (18 vs 22) | **Stale → Resolved** | Empty business seed; separate dev fixture | D.4 |
| S5 | OBD-003 language status recorded three ways | **Stale → Resolved** | Bilingual AR/EN + RTL; next-intl in scope | C.3 |
| S6 | Phone-based customer identity remnants | **Stale → Resolved** | Session-derived identity only; obsolete list published | E.1 |
| S7 | Payment rejection vs terminal booking rejection | **Blocker → Resolved** | Two actions; two state-machine entries | G.1 |
| S8 | PM2 1 vs 2 instances; cron safety | **Stale → Resolved** | Two instances; READ COMMITTED re-qualification | I.2 |
| S9 | `X-Requested-With` as CSRF control | **Stale → Resolved** | Not used; SameSite + Content-Type + form token | E.4 |
| S10 | Rate-limit keys IP vs account; customer login absent | **Resolved** | Dual-key matrix | I.6 |
| S11 | `src/app/middleware.ts` vs `src/middleware.ts` | **Resolved** | `src/middleware.ts` | C.2 |
| S12 | `postgres` v3 vs `pg` v8 | **Resolved** | `pg` ^8 + `drizzle-orm/node-postgres` | C.1 |
| S13 | Court photos have no schema | **Resolved** | Dedicated `court_images` table | D.5 |
| S14 | Google OAuth library unspecified; env vars missing | **Resolved** | `arctic`; three env vars added | E.2 |
| S15 | `viewer` holds `manage_customers` | **Resolved** | Split `view_customers` / `manage_customers` | E.5 |
| S16 | `/review` gated on a read permission | **Resolved** | `view_bookings` + `approve_booking` | E.5 |
| S17 | Booking reference uses UTC `toISOString()` | **Resolved** | Build from the validated Cairo date string | F.3 |
| S18 | UptimeRobot target `/api/health` vs `/ready` | **Resolved** | `/api/health/ready`; alias retained; confirmation retries | I.3 |
| S19a | NGINX general zone 120 r/m vs 60 r/m | **Stale → Resolved** | 120 r/m | I.6 |
| S19b | `BOOKING_EXPIRY_MINUTES=120` shown as a default | **Stale → Resolved** | No default; startup throws | I.4 |
| S19c | `expires_at` on `pending → payment_submitted` | **Resolved** | Unchanged there; reset on payment rejection | F.5 |
| S19d | `req.json()` on a multipart endpoint (`11…` §6) | **Impl** | Booking creation is multipart | — |
| S19e | Two steps numbered "8" (`22…` §8.2) | **Impl** | Cosmetic | — |
| S19f | TLS check asserting TLS 1.2 fails (`23…` §16.4) | **Stale** | TLS 1.2 is the documented minimum (`03…` NFR-SEC-001); verify 1.3 is offered and 1.1 refused | — |
| S19g | Garbled request-ID trust rule (`23…` REL-M0-T05) | **Impl** | Trust inbound `x-request-id` only from Cloudflare ranges (see §I.5); otherwise generate | — |
| S19h | `SLACK_WEBHOOK_URL` absent from `.env.example` | **Impl** | Add as optional; backup alerting degrades to email if unset | — |
| S19i | Sentry v7 vs v8 integration form | **Impl** | v8 functional form | C.5 |
| S19j | `DUPLICATE_BOOKING` missing from the error-code table | **Impl** | Add to `11…` §3 set; HTTP 409 | — |
| S19k | `booking_range` printed after the table's closing paren | **Impl** | Applied via `ALTER TABLE` in the raw migration | D.2 |
| S19l | `customer_accounts` lacks `deleted_at` | **Resolved** | Column added at M0 | D.6 |
| S19m | `GET /api/v1/courts` exposes court UUIDs vs "no internal UUIDs" | **Resolved** | Court IDs are non-sensitive and required for booking; the rule targets booking and customer IDs | — |
| S19n | Grant-before-tables-exist; REVOKEs may no-op | **Resolved** | `ALTER DEFAULT PRIVILEGES` + re-apply REVOKEs post-migration | D.1 |
| S19o | DR-05 / verify-backup assume local `psql` superuser | **Impl** | Rewrite against connection strings | D.1 |
| S20 | OBD-001, 002, 004, 005 unresolved | **Owner** | See §L | L |
| NEW-1 | `24:00` slot unbookable under the documented regex | **Blocker → Resolved** | `endTime` regex accepts `24:00`; +1 h cross-field rule | F.4 |
| NEW-2 | Cloudflare collapses all clients into one rate-limit bucket | **Blocker → Resolved** | `set_real_ip_from` + `CF-Connecting-IP` | I.5 |
| NEW-3 | Duplicate `phone_number` on a second account violates the unique index | **Impl** | Field-level validation error, never a 500 | D.6 |

---

## L. Remaining owner / business decisions

These are business policy, not technical. They cannot be decided by the development team (`00-index.md` closing statement). Implementation must build the mechanism and leave the value unset.

| OBD | Question | Needed by | Consequence if unresolved | Source |
|---|---|---|---|---|
| **OBD-002** | How long is a slot held for a customer who has not uploaded proof? | **M3 start** | The application refuses to start without `BOOKING_EXPIRY_MINUTES` (§I.4). Development uses a local throwaway value. | `21…` §9; `22…` §4.6 |
| **OBD-004** | Exact operating days and hours | Before real data entry / launch | `operating_hours` stays empty; the public booking flow shows "Booking not currently available"; the admin configures it via the dashboard. Does **not** block M0–M2. | `21…` §9; `22…` §4.5 |
| **OBD-001** | May customers cancel their own bookings, and until when? | **M4/M5** | Default stands: admin-only cancellation. If reversed, adds a customer-actor transition, a customer-facing endpoint, time-limit rules, and acceptance criteria (est. 2–3 days per `21…` §9). | `01…` Q2; `21…` OBD-001 |
| **OBD-005** | Accept that `payment_submitted` holds a slot indefinitely pending admin action? | Before launch; written acknowledgement | §G.1 partially mitigates it — a rejected payment now returns to `pending` and expires normally — but a proof awaiting review still holds the slot until an admin acts. | `21…` ISSUE-004, OBD-005; `23…` §16.11 |

**Also unresolved but defaulted (no action needed unless the owner objects):** Q3 pricing granularity (per court, day-of-week + time range + priority — already implemented in `05…` §4.3); Q5 admin notifications (pending-count banner only); Q7 court count (admin-created, any number); Q9 group discounts and recurring bookings (out of scope).

---

## M. Decisions that must NOT be changed during implementation

If any of these appears to need changing, stop and escalate. Do not work around them.

1. **The exclusion constraint is never weakened, dropped, or made conditional.** `court_id WITH =` + `booking_range WITH &&` `WHERE (status = 'approved')`. Application checks are supplementary. (`23…` §4.2)
2. **PostgreSQL is the only source of transactional truth.** Nothing is confirmed from cache or memory. Availability display may cache for 60 s; booking creation always reads live. All booking writes go to the primary. (`23…` §4.2–4.3)
3. **Never trust the browser** for price, booking status, payment status, permissions, availability, or identity. (`22…` Preamble #2)
4. **`customer_account_id` comes from the session. Always.** (`19…` AC-CUS-010; §E.1)
5. **Price is absent from the booking creation schema** and is calculated server-side from `court_pricing_rules`. (`13…` T-007)
6. **Payment verification is manual and permission-gated.** No automatic verification may ever be introduced. (`01…` C2; `02…` FR-PAY-009)
7. **`rejected`, `cancelled` and `expired` are terminal.** No actor transitions out of them. (`06…` §5; §G.1)
8. **Audit logs are append-only, enforced at the database role level.** (`03…` NFR-DATA-008; `05…` §9)
9. **`bookings.price_amount` is immutable after creation.** (`03…` NFR-DATA-003)
10. **Bookings, payment records and payment proofs are never hard-deleted.** (`03…` NFR-DATA-007)
11. **No invented business values.** No default expiry, no seeded hours/courts/pricing, no placeholder InstaPay number. (`22…` Preamble #4)
12. **Booking reference prefix comes from `venues.booking_ref_prefix`.** Never a constant. (`21…` RC-003)
13. **All date/time logic in `Africa/Cairo`.** (`22…` §8.1)
14. **Application instances are stateless.** No local files, no in-memory caches of domain state, no server-side session store. (`23…` §1.3)
15. **Every admin route: session → permission → venue scope → audit on mutation.** (`21…` SF-002)
16. **`VENUE_ID` is a server env var**, never a URL parameter or request field. (`10…` §4.4)
17. **File upload is non-blocking; the booking reference is always returned.** (`21…` RC-002)
18. **Mutation endpoints are never retried at the load balancer.** (`23…` §1.6)
19. **V1 is The Field only.** No venue selector, listing, onboarding, or owner accounts. (`22…` Preamble #1)
20. **No microservices, Kubernetes, Redis, or BullMQ in V1.** (`01…` §4.2; `23…` §13.2)
21. **Security requirements are launch blockers**, not backlog items. (`23…` §16.4)
22. **Modules never query another module's tables.** (`04…` §3)

---

## N. Final milestone sequence

**Authoritative:** the `22…` §16 / `23…` §14 sequence. `18…` §2 and `21…` §12's endorsement of it are **stale** — `21…` was written before `22…` restructured the milestones, and `23…`'s task IDs, quality gates (§15) and Definition of Done (§16) are all built on the `22…` numbering. Following `18…` would build the booking engine before authentication exists to own bookings.

| M | Name | Content | Gate |
|---|---|---|---|
| **M0** | Foundation | Extension + constraint verification, project init, test infrastructure, full schema, raw migrations, seed, config, logger, CI, hooks, Sentry, Docker; 2 PM2 instances, health endpoints, graceful shutdown, pool, request ID, NGINX JSON logs + real-IP | §O |
| **M1** | Database, auth, RBAC, audit, customer auth | DB client + transaction helper, admin session/password/repo, login/logout/me, permissions, login UI, admin layout guard, dashboard skeleton, security headers middleware, rate limiters, change-password, audit service; customer auth (Google + email/password), cross-instance sessions, DB-failure 503, startup validation | `22…` Gate 1 + `23…` Gate M1 |
| **M2** | CMS, public website, i18n, storage | Storage service, CMS repo/service/API, public layout + all pages, admin CMS editors, booking-status page; bilingual AR/EN + RTL, animations, sign-in page + auth gate | `22…` Gate 2 + `23…` Gate M2 |
| **M3** | Availability + booking engine | Venue/courts services, pricing calculator, slot generator, conflict detector, availability API, reference generator, state machine, booking creation transaction, expiry job, booking UI steps 1–5, duplicate guard, all double-booking tests, timezone tests | `22…` Gate 3 + `23…` Gate M3 |
| **M4** | Payment proof + approval | Payments repo, file validation, upload pipeline + integrity check, proof view signed URL, approve/reject-booking/**reject-payment**/cancel services, admin booking list + detail + action UI, late upload, proof security tests | `22…` Gate 4 + `23…` Gate M4 |
| **M5** | Admin management | Courts, pricing, schedule, customers, administrators, audit viewer, settings, dashboard polish, mobile admin, idempotency tests, job heartbeat, DB connection indicator | `22…` Gate 5 + `23…` Gate M5 |
| **M6** | Hardening + launch | ZAP, Burp, Semgrep, gitleaks, Lighthouse (EN+AR), k6 LOAD-T01…T07, DR rehearsal, backup restore, PM2 reboot, integrity cron, btree_gist startup check, Cloudflare verification, runbooks, privacy policy, README + admin guide, production deploy, owner acceptance | `23…` §15 Gate M6 + §16 DoD |

**Gate rule:** `23…` §15 **extends** `22…` §18 — it never replaces it. Both lists apply. The authoritative Definition of Done is `23…` §16, amended by this document (§D.2 TSRANGE, §E.5 permissions, §G.1 payment rejection, §F.4 slot boundary).

**Blocking pre-conditions:** M0 cannot complete without the §O checklist. M3 cannot start without OBD-002. Launch cannot occur without OBD-004 and written OBD-005 acknowledgement.

---

## O. M0 acceptance criteria

M0 is complete when **every** item passes. Items marked **[24]** originate in this document.

### Database and integrity
- [ ] Managed provider selected; **every row of the §D.1 qualification checklist verified against the real instance** **[24]**
- [ ] `CREATE EXTENSION IF NOT EXISTS btree_gist;` succeeds; `uuid-ossp` and `pgcrypto` present
- [ ] All tables from `22…` §4.2 defined in Drizzle, in dependency order, including `court_images` **[24]** and `customer_accounts.deleted_at` **[24]**
- [ ] `venues.booking_ref_prefix`, `admin_users.must_change_password`, `payment_proof_viewed` in `audit_action`, no `chk_booking_date_future`
- [ ] `booking_range TSRANGE GENERATED ALWAYS AS (tsrange(booking_date + start_time, booking_date + end_time)) STORED` created without an immutability error **[24]**
- [ ] `no_overlapping_approved_bookings` present with `court_id WITH =`, `booking_range WITH &&`, `WHERE (status='approved')`
- [ ] Direct SQL: duplicate approved overlap raises `23P01`; adjacent slot succeeds; 23:00–24:00 slot inserts correctly **[24]**
- [ ] `uq_court_name_per_venue_active` and `idx_bookings_admin_list` created
- [ ] `db:migrate` then `db:migrate:raw` run cleanly, and are **idempotent on a second run**
- [ ] Roles created; `ALTER DEFAULT PRIVILEGES` applied; `REVOKE`s re-applied **after** migrations and verified by attempting a DELETE on `bookings` and an UPDATE on `audit_logs` as `app_user` **[24]**
- [ ] `db:seed` creates only venue + roles + permissions (**16 permissions incl. `view_customers`** **[24]**) + one `must_change_password` super-admin; no hours, courts, pricing, or CMS content

### Application
- [ ] `npm run dev` starts; `typecheck` passes; `lint` passes with 0 warnings
- [ ] `tsconfig.json` `"strict": true`; ESLint forbids `any`
- [ ] Middleware at **`src/middleware.ts`**, and a test asserts the security headers and CSP nonce appear on a real response **[24]**
- [ ] `src/lib/config.ts` throws at load for a missing `VENUE_ID`, `SESSION_SECRET` (<32 chars), `DATABASE_URL`, `STORAGE_PROVIDER`, or `BOOKING_EXPIRY_MINUTES`
- [ ] pino redacts `customerPhone`, `phone_number`, `password`, `storageKey`, cookies
- [ ] Sentry initialised; DSN optional; `beforeSend` scrubbing in place
- [ ] `pg` ^8 with `drizzle-orm/node-postgres`; pool max/min from env; `pool.on('error')` → Sentry + pino **[24]**

### Reliability
- [ ] Two PM2 instances online (3000, 3001); `exec_mode: fork`; `kill_timeout: 35000`
- [ ] `/api/health/live` returns 200 with no DB dependency
- [ ] `/api/health/ready` returns 200 connected, 503 with the DB unreachable
- [ ] SIGTERM → readiness 503 within 2 s → clean exit within 35 s
- [ ] NGINX: both upstreams, `proxy_next_upstream off` on `/api/v1/bookings`, JSON access log parses with `jq`
- [ ] **NGINX `set_real_ip_from` + `real_ip_header CF-Connecting-IP` configured; two distinct client IPs produce two distinct logged IPs** **[24]**
- [ ] `x-request-id` present on every API response

### Tooling
- [ ] Vitest `unit` and `integration` projects; testcontainers PostgreSQL starts; factories for venue, court, pricing rule, operating hours, customer account, booking, admin, role
- [ ] Playwright launches and exits cleanly
- [ ] `docker compose up -d` starts PostgreSQL 16 and migrations run against it
- [ ] CI passes on an empty commit: tsc, eslint, unit, integration, `npm audit --audit-level=high`, Semgrep, gitleaks, build
- [ ] Pre-commit hook blocks a type error and a planted secret
- [ ] `.gitignore` covers `.env*`, `/storage`, `/node_modules`, `/.next`, `*.sql.gz`
- [ ] `.env.example` complete, including `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` **[24]**, blank `BOOKING_EXPIRY_MINUTES` with its OBD-002 note, and optional `SLACK_WEBHOOK_URL` **[24]**
- [ ] `gitleaks detect` finds no secret in history

---

## IMPLEMENTATION BASELINE APPROVED

The following is the complete list of decisions to follow during implementation. Where this list and any other document disagree, **this list wins**.

**Architecture**
1. Modular monolith, Next.js 14 App Router, single VPS. No microservices, Kubernetes, Redis, or BullMQ.
2. Modules communicate through service functions only. Nothing imports `bookings` except `admin` and `notifications`.
3. V1 is The Field only. Schema stays venue-aware; UI has no venue concept. `VENUE_ID` is a server env var.

**Technology**
4. `pg` ^8 with `drizzle-orm/node-postgres`. Not postgres.js.
5. Middleware lives at `src/middleware.ts`.
6. `next-intl`, bilingual Arabic + English, full RTL, from Milestone 2. OBD-003 is resolved.
7. Google OAuth via `arctic` + iron-session. No NextAuth, no Lucia. GET-initiated redirect; state + PKCE in a short-lived signed cookie; fixed redirect URI; same-origin relative redirect targets only.

**Database**
8. Managed PostgreSQL 16 in staging and production; Docker locally; never self-managed on the app VPS. Verify the §D.1 checklist before schema work.
9. `booking_range TSRANGE GENERATED ALWAYS AS (tsrange(booking_date + start_time, booking_date + end_time)) STORED`. The exclusion constraint keeps `court_id WITH =` + `booking_range WITH &&` `WHERE (status='approved')`. Never weaken it.
10. RC-001 (as amended) through RC-007 all applied, plus `idx_bookings_admin_list`.
11. `court_images` is a dedicated table. Do not add `entity_type`/`entity_id` to `cms_gallery_items`.
12. Table name is `customer_accounts`, with `deleted_at` added.
13. Production seed contains no courts, hours, pricing, or CMS content. Dev fixtures are separate and never run against staging or production.
14. `ALTER DEFAULT PRIVILEGES` before migrations; `REVOKE`s re-applied and verified after.

**Identity and authorisation**
15. Booking ownership always comes from `session.customerId`. Phone number is contact data only. Every phone-based lookup listed in §E.1 is obsolete.
16. 16 permissions. `view_customers` is new. `viewer` = `view_bookings`, `view_payment_proof`, `view_customers`, `view_audit_logs`.
17. `/review` requires `view_bookings` + `approve_booking`. `PATCH /admin/customers/{id}` requires `manage_customers`.
18. CSRF = `SameSite=Lax` + `Content-Type: application/json` + a customer form token. `X-Requested-With` is not used.

**Booking**
19. Two-layer concurrency guard: SERIALIZABLE + `FOR UPDATE`, plus the exclusion constraint; `23P01` → HTTP 409.
20. The two-pending-bookings race is accepted, documented and tested — not "fixed".
21. `endTime` regex accepts `24:00`; service layer enforces `endTime = startTime + 1h`.
22. Booking references are built from the validated `YYYY-MM-DD` Cairo date string. No `toISOString()`.
23. `expires_at`: set at creation, untouched on proof upload, cleared on approval, reset on payment rejection.
24. Expiry affects only `pending` bookings; it runs at READ COMMITTED; audit rows come from `RETURNING` only.

**Payment**
25. Two rejection paths: `POST /admin/bookings/{id}/payment/reject` (`reject_payment`) returns the booking to `pending` with a fresh `expires_at` and is recoverable; `POST /admin/bookings/{id}/reject` (`reject_booking`) is terminal and irreversible.
26. State machine gains exactly two entries: `payment_submitted→pending:admin`, `under_review→pending:admin`.
27. Payment verification is manual, permission-gated, and never automatic. Payment status is never accepted from a client.
28. Upload is non-blocking; `exists()` must confirm the object before the `payment_proofs` row is written; the reference is always returned.
29. The InstaPay number comes from CMS; if empty, submission is disabled. No placeholder value anywhere.

**Storage**
30. R2 in staging and production; local disk in development only. No persistent files on the VPS.
31. Private proofs behind 5-minute signed URLs, permission-checked, IDOR-checked, and audit-logged on every view.

**Infrastructure**
32. Tier 2 from day one: Cloudflare + Hostinger KVM 2 + 2 PM2 instances + managed PostgreSQL + R2.
33. Both instances run the expiry job; safety comes from READ COMMITTED re-qualification on the atomic UPDATE. No `job_locks` in V1.
34. NGINX must set `set_real_ip_from` (Cloudflare ranges) + `real_ip_header CF-Connecting-IP` before any rate limit is meaningful.
35. Rate limits follow the §I.6 matrix: IP for anonymous endpoints, IP **and** account for authenticated ones.
36. UptimeRobot monitors `/api/health/ready` with confirmation retries. `/api/health/live` is for process liveness; `/api/health` remains as an alias.
37. `BOOKING_EXPIRY_MINUTES` has no default; startup fails without it on every environment.
38. Graceful shutdown: readiness 503 → 30 s drain → pool close → exit 0, with `kill_timeout: 35000`. `proxy_next_upstream off` on booking creation.

**Process**
39. Milestone order is M0 → M1 (auth) → M2 (CMS/public/i18n) → M3 (booking engine) → M4 (payment) → M5 (admin) → M6 (hardening).
40. Both `22…` §18 and `23…` §15 gates apply at every milestone. The Definition of Done is `23…` §16 as amended here.
41. All ten double-booking tests plus the §J.2 additions are mandatory.
42. OBD-001, OBD-002, OBD-004 and OBD-005 remain owner decisions. Build the mechanism; never invent the value.

---

*Document 24 — Specification Reconciliation and Decision Record — The Field V1 — September 2, 2026*
*Supersedes conflicting statements in Documents 00–23 as listed in Section A.*
*Next action: begin Milestone 0 against the acceptance criteria in Section O.*
