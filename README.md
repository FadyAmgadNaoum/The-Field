# The Field — Padel Court Booking

Booking website and administration dashboard for **The Field**, a padel venue in Egypt.

Version 1 covers one venue. Customers browse courts and availability without signing in, authenticate to submit a booking, pay by InstaPay transfer, and upload a screenshot as proof. An administrator verifies every payment by hand — the system never auto-confirms one.

---

## Specification

The `docs/` directory is the specification. Read these first:

| Document | Purpose |
| --- | --- |
| [`docs/24-specification-reconciliation.md`](docs/24-specification-reconciliation.md) | **Authoritative.** Resolves every conflict between Documents 00–23. Start here. |
| [`docs/23-production-reliability-architecture.md`](docs/23-production-reliability-architecture.md) | Infrastructure, reliability, quality gates, Definition of Done |
| [`docs/22-implementation-blueprint.md`](docs/22-implementation-blueprint.md) | Directory structure, module contracts, task breakdown |
| [`docs/00-index.md`](docs/00-index.md) | Index of all specification documents |

When a document disagrees with Document 24, **Document 24 wins**.

---

## Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20 LTS | Production targets Node 20 (`docs/15` §3). Newer majors work for development. |
| npm | 10+ | |
| Docker Desktop | any recent | Local PostgreSQL only |

Production and staging use **managed PostgreSQL 16** — never a database on the application VPS (`docs/24` §D.1).

---

## Local setup

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env.local
```

Then edit `.env.local`:

```bash
SESSION_SECRET=<paste output of: openssl rand -hex 64>
BOOKING_EXPIRY_MINUTES=120     # local throwaway value — see the note below
SEED_ADMIN_EMAIL=you@example.com
SEED_ADMIN_PASSWORD=<a password you will change on first login>
```

```bash
# 3. Start PostgreSQL (creates app_user, migration_user, backup_user
#    and the required extensions on first run)
docker compose up -d

# 4. Apply the schema — BOTH commands, in this order
npm run db:migrate       # Drizzle-generated migrations
npm run db:migrate:raw   # generated column, exclusion constraint, indexes,
                         # CHECK constraints, role privileges

# 5. Seed the venue, roles, permissions and the initial administrator
npm run db:seed
#    -> prints VENUE_ID=<uuid>; copy it into .env.local

# 6. Run
npm run dev              # http://localhost:3000
```

### `BOOKING_EXPIRY_MINUTES`

This variable has **no default and never will**. It encodes OBD-002 — an unresolved business decision about how long a court is held for a customer who has not paid. The application refuses to start without it, on every environment, so that no invented value can reach production (`docs/24` §I.4).

The value you set locally carries no business meaning. Do not copy it to staging or production.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint, zero warnings tolerated |
| `npm run format` | Rewrite files with Prettier |
| `npm run format:check` | Verify formatting without writing |
| `npm run test:unit` | Unit tests — fast, no database |
| `npm run test:integration` | Integration tests — **requires** a running database |
| `npm run db:up` / `db:down` | Start / stop local PostgreSQL |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply Drizzle migrations |
| `npm run db:migrate:raw` | Apply raw SQL migrations |
| `npm run db:seed` | Seed venue, roles, permissions, first administrator |
| `npm run db:studio` | Drizzle Studio |

Before opening a pull request:

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test:unit && npm run build
```

---

## Layout

```
src/
├── app/                     Next.js App Router
│   ├── api/health/          live · ready · combined
│   └── api/v1/              versioned API namespace
├── db/
│   ├── schema/              one file per table
│   ├── migrations/          Drizzle-generated
│   │   └── raw/             SQL Drizzle cannot express
│   ├── migrate.ts           db:migrate
│   ├── migrate-raw.ts       db:migrate:raw
│   └── seed.ts              db:seed
├── lib/
│   ├── api/                 response envelope, route wrapper, request context
│   ├── config/              environment validation
│   ├── db/                  pool and Drizzle client
│   ├── errors/              application error model
│   ├── lifecycle/           graceful shutdown
│   ├── rbac/                permission catalogue
│   ├── logger.ts            pino with redaction
│   └── observability.ts     error-capture seam
├── middleware.ts            security headers, CSP nonce, request id
└── instrumentation.ts       process lifecycle hooks

docker/initdb/               local-only role and extension bootstrap
nginx/thefield.conf          reverse proxy, rate limits, Cloudflare real-IP
ecosystem.config.js          PM2 — two instances
tests/{unit,integration}/
```

---

## The one thing not to break

Two approved bookings can never overlap on the same court. This is enforced by a PostgreSQL exclusion constraint, not by application code:

```sql
EXCLUDE USING GIST (court_id WITH =, booking_range WITH &&)
  WHERE (status = 'approved')
```

`booking_range` is a stored generated column:

```sql
tsrange(booking_date + start_time, booking_date + end_time)
```

`docs/05` §4.9 and `docs/21` RC-001 specify a `TSTZRANGE` built with `AT TIME ZONE 'Africa/Cairo'`. **That expression cannot be used**: PostgreSQL requires a generated column's expression to be `IMMUTABLE`, and `timestamp AT TIME ZONE text` is `STABLE`. `docs/24` §D.2 records the analysis and the equivalent immutable form above.

The constraint is never weakened, dropped, or made conditional (`docs/23` §4.2). `tests/integration/db/booking-integrity.test.ts` proves it holds — including that adjacent slots, different courts and different dates remain bookable.

---

## Infrastructure controls

Some controls live in the proxy, not the application. They are configured in `nginx/thefield.conf` and are not exercised by the test suite:

- **Cloudflare real-IP restoration** (`set_real_ip_from` + `real_ip_header CF-Connecting-IP`). Without it every visitor shares one rate-limit bucket — see `docs/24` §I.5.
- **TLS termination and HTTP→HTTPS redirect.**
- **Coarse per-IP rate limiting** ahead of the application's finer per-account limits.
- **`proxy_next_upstream off`** on booking creation: retrying a mutation at the load balancer could create a duplicate booking.

---

## Deployment

Not yet automated. Target architecture is `docs/23` §13: Cloudflare → Hostinger VPS running NGINX and two PM2 instances → managed PostgreSQL → Cloudflare R2. Deployment scripts, CI, and the operations runbooks are Milestone 6.
