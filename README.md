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

### Storage

`STORAGE_PROVIDER=local` writes uploads under `LOCAL_STORAGE_PATH` (default
`./storage`) and serves them from `/media`, which exists in development only —
the environment schema refuses `local` in production, and the media route
refuses to serve anything when `NODE_ENV=production` (`docs/24` §H.1).

For `STORAGE_PROVIDER=s3`, set `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_PRIVATE_BUCKET`, `S3_PUBLIC_BUCKET` and
`S3_PUBLIC_BASE_URL`. These are deliberately not required at startup — the
startup-required set is fixed by Doc 22 M0-T07 — so the S3 backend validates
them on first use and reports exactly which are missing.

`S3_PUBLIC_BASE_URL` is additionally read at **build time** to register the
public media host with `next/image`. A build with it unset still succeeds;
remote images simply are not optimised until it is set.

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
| `npm run test:a11y` | Accessibility audit — **requires** the app running on port 3000 |
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

The accessibility audit fetches each public page from a running application and
runs axe-core against the real server-rendered HTML, so it needs a server:

```bash
npm run dev          # in one terminal
npm run test:a11y    # in another  (override the origin with A11Y_BASE_URL)
```

---

## Public website

The customer-facing site is bilingual Arabic and English with full RTL
(Doc 24 §C.3). The locale is always the first path segment, so `/` redirects to
the visitor's preferred language.

| Route | Contents |
| --- | --- |
| `/{locale}` | Home — hero, announcements, about, courts preview, gallery strip |
| `/{locale}/courts` | Active courts with photos and features |
| `/{locale}/pricing` | Published rate card per court |
| `/{locale}/about` | About text and opening hours |
| `/{locale}/faq` | Published questions and answers |
| `/{locale}/gallery` | Published gallery images |
| `/{locale}/contact` | Phone, WhatsApp, email, address — whatever is configured |
| `/{locale}/signin` | Customer sign-in and registration |
| `/{locale}/booking-status` | Booking lookup for the signed-in account |

Every one of these renders correctly when the CMS and the venue tables are
empty, which is the state the application ships in — no page invents a phone
number, a price, an opening hour or an InstaPay account.

The booking flow itself (court → date → time → details → confirmation) is
Milestone 3; `/{locale}/book` does not exist yet, and the "Book now" call to
action leads to the courts page until it does.

### Content administration

`/admin/cms/settings` plus one editor per collection — FAQs, gallery, events,
announcements, social links. All require the `manage_cms` permission, all write
an audit row, and all invalidate the public cache tag so a saved change appears
on the site immediately. The admin dashboard is English-only in V1.

### Adding or changing UI text

Customer-facing strings live in `messages/en.json` and `messages/ar.json` — never
in JSX. A unit test fails the build if the two files drift apart, if a value is
empty, or if an ICU placeholder differs between them.

---

## Layout

```
src/
├── app/                     Next.js App Router
│   ├── [locale]/            public website — its own root layout (lang + dir)
│   ├── admin/               dashboard — its own root layout, English only
│   ├── media/               local-disk media route (development only)
│   ├── api/health/          live · ready · combined
│   └── api/v1/              versioned API namespace
├── i18n/                    locale config, request config, navigation helpers
├── db/
│   ├── schema/              one file per table
│   ├── migrations/          Drizzle-generated
│   │   └── raw/             SQL Drizzle cannot express
│   ├── migrate.ts           db:migrate
│   ├── migrate-raw.ts       db:migrate:raw
│   └── seed.ts              db:seed
├── components/
│   ├── ui/                  button, card, field, feedback, layout primitives
│   ├── layout/              header, mobile nav, footer, language switcher
│   ├── public/              court card, sign-in form, booking status lookup
│   └── admin/               CMS editors
├── modules/                 domain modules — service + repository per boundary
│   ├── cms/                 settings catalogue, collections, image pipeline
│   ├── storage/             R2 / local-disk abstraction, ULID keys
│   ├── courts/ venue/ pricing/   read-side services for the public pages
│   ├── bookings/ payments/  status lookup only until Milestone 3
│   └── admin/ audit/ customers/
├── lib/
│   ├── api/                 response envelope, route wrapper, admin guard
│   ├── config/              environment validation
│   ├── db/                  pool and Drizzle client
│   ├── errors/              application error model
│   ├── lifecycle/           graceful shutdown
│   ├── rbac/                permission catalogue
│   ├── ui/                  cn(), locale-aware formatting, browser API client
│   ├── validation/          Zod schemas, magic-byte upload validation
│   ├── cms-sanitize.ts      rich-text sanitisation, applied at write time
│   ├── logger.ts            pino with redaction
│   └── observability.ts     error-capture seam
├── middleware.ts            security headers, CSP nonce, request id, locale
└── instrumentation.ts       process lifecycle hooks

messages/                    en.json · ar.json — every customer-facing string
docker/initdb/               local-only role and extension bootstrap
nginx/thefield.conf          reverse proxy, rate limits, Cloudflare real-IP
ecosystem.config.js          PM2 — two instances
tests/{unit,integration,a11y}/
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
