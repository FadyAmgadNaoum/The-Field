# Implementation Roadmap
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. Approach

The implementation is organized into 6 milestones. Each milestone produces a working, deployable increment of the system. Earlier milestones focus on the core booking engine (highest risk, highest value). Later milestones add the admin dashboard, CMS, and polish.

**Estimated total:** 14–16 weeks for a team of 1–2 developers.

---

## 2. Milestones

### Milestone 0: Foundation (Week 1–2)
**Goal:** Working development environment, database schema, deployment pipeline.

| Task | Priority |
|------|----------|
| Initialize Next.js 14 project with TypeScript and Tailwind CSS | P1 |
| Configure ESLint, Prettier, Vitest, Playwright | P1 |
| Set up Docker Compose for local PostgreSQL | P1 |
| Define Drizzle ORM schema (all tables from DB architecture doc) | P1 |
| Write and run initial migration | P1 |
| Seed: one venue, 2 courts, operating hours, pricing rules, super_admin | P1 |
| Set up Sentry integration | P1 |
| Configure NGINX + PM2 on staging VPS | P1 |
| Set up GitHub repository and CI pipeline (typecheck + lint + test) | P1 |
| Configure Cloudflare R2 buckets (private + public) | P1 |
| Write `.env.example` with all required variables | P1 |

**Definition of Done:** `npm run dev` starts the application; `npm run db:migrate && npm run db:seed` succeeds; CI pipeline passes on an empty commit.

---

### Milestone 1: Booking Engine Core (Week 3–5)
**Goal:** A customer can make a booking request via API. Availability works correctly. Booking integrity is enforced at the database level.

| Task | Priority |
|------|----------|
| `courts` module: getActiveCourts, getCourtById | P1 |
| `venue` module: getOperatingHours, isDateOperational | P1 |
| `availability` module: generateSlots, checkConflict | P1 |
| `pricing` module: calculatePrice, getPricingRules | P1 |
| `bookings` module: createBooking (full transaction) | P1 |
| `customers` module: upsertCustomer | P1 |
| `payments` module: createPaymentRecord | P1 |
| `storage` module: S3StorageService + LocalDiskStorageService | P1 |
| File upload validation pipeline (MIME check, size, safe key) | P1 |
| Booking reference generator (TF-YYYYMMDD-XXXX) | P1 |
| Booking expiry job (node-cron, 15-minute interval) | P1 |
| `POST /api/v1/bookings` route handler | P1 |
| `GET /api/v1/availability` route handler | P1 |
| `POST /api/v1/bookings/proof` route handler | P1 |
| `POST /api/v1/booking-status` route handler | P1 |
| Rate limiting (rate-limiter-flexible) on above routes | P1 |
| Unit tests: price calculator, availability, state machine, conflict detection | P1 |
| Integration tests: booking creation, concurrent booking, blocked dates | P1 |
| Integration test: expiry job | P1 |

**Definition of Done:** All unit and integration tests pass. Concurrent booking test confirms only 1 booking succeeds out of 10 simultaneous requests. Price manipulation test confirms server ignores client-submitted price.

---

### Milestone 2: Customer-Facing UI (Week 6–8)
**Goal:** A customer can visit the website, view courts, complete the booking flow, and check their booking status.

| Task | Priority |
|------|----------|
| Design system: Tailwind theme (colors, fonts, spacing) matching The Field branding | P1 |
| Layout: header, footer, navigation, WhatsApp button | P1 |
| Home page (hero, about section, courts preview — CMS data hardcoded initially) | P1 |
| Courts page (list all active courts) | P1 |
| Pricing page | P1 |
| Booking flow — Step 1: Court selection | P1 |
| Booking flow — Step 2: Date picker (disabled dates for blocked/closed days) | P1 |
| Booking flow — Step 3: Time slot grid (available/unavailable) | P1 |
| Booking flow — Step 4: Customer form + InstaPay instructions + proof upload | P1 |
| Booking flow — Step 5: Confirmation screen with reference | P1 |
| Booking status lookup page | P1 |
| Late proof upload UI (on status page when booking is pending) | P1 |
| About page (static content initially) | P2 |
| FAQs page (static content initially) | P2 |
| Gallery page (placeholder) | P2 |
| Contact page | P2 |
| Mobile responsiveness audit (all booking flow pages) | P1 |
| Accessibility audit (axe-core on all pages) | P1 |
| E2E tests: full booking flow, status lookup, IDOR attempt, price manipulation | P1 |

**Definition of Done:** A Playwright test completes the entire booking flow on a mobile viewport (390px) without errors. Lighthouse mobile score ≥ 85 on booking page.

---

### Milestone 3: Admin Authentication and Booking Management (Week 9–10)
**Goal:** An administrator can log in, review bookings, view payment proofs, and approve or reject bookings.

| Task | Priority |
|------|----------|
| Admin login page (`/admin/login`) | P1 |
| iron-session setup with `sessions_invalidated_at` check | P1 |
| Admin layout with navigation sidebar | P1 |
| Admin auth middleware (protect all /admin routes) | P1 |
| Permission check middleware (`requirePermission`) | P1 |
| Dashboard overview page (pending counts, today's bookings) | P1 |
| Booking list page (filters: status, court, date, search) | P1 |
| Booking detail page (all fields, payment proof viewer) | P1 |
| Approve booking endpoint + confirmation dialog | P1 |
| Reject booking endpoint + reason dialog | P1 |
| Cancel booking endpoint + reason dialog | P1 |
| Mark under review endpoint | P1 |
| Payment proof signed URL endpoint | P1 |
| Admin logout | P1 |
| Audit log writer (integrated into all state-change operations) | P1 |
| E2E tests: admin login, approve booking, reject booking, unauthorized access | P1 |
| E2E test: concurrent approval conflict | P1 |

**Definition of Done:** Admin can complete the full approval workflow in the UI. Concurrent approval test confirms DB constraint prevents double-approval.

---

### Milestone 4: Court, Pricing, and Schedule Management (Week 11–12)
**Goal:** Administrator can manage courts, pricing rules, and the venue schedule without developer involvement.

| Task | Priority |
|------|----------|
| Courts list, add, edit, disable/enable pages | P1 |
| Pricing rules list, create, edit, delete per court | P1 |
| Operating hours editor (7-day grid) | P1 |
| Blocked dates calendar | P1 |
| Blocked time periods management | P1 |
| Maintenance periods management | P1 |
| Customer list and search | P2 |
| Administrator management (create, edit, deactivate) | P1 |
| Audit log viewer | P1 |
| E2E tests: add court, change price, block date, create maintenance period | P1 |
| E2E test: verify blocked date prevents new bookings on customer side | P1 |

**Definition of Done:** Admin can add a new court and it immediately appears in the public courts page and booking flow.

---

### Milestone 5: CMS and Content Polish (Week 13–14)
**Goal:** All website content is CMS-driven. Administrator can update any text, image, or configuration without developer help.

| Task | Priority |
|------|----------|
| CMS settings editor (all groups: general, contact, payment, homepage, about, SEO) | P1 |
| Replace all hardcoded content in public pages with CMS-fetched data | P1 |
| InstaPay number and instructions now come from CMS | P1 |
| FAQs editor (create, edit, reorder, publish) | P2 |
| FAQs public page now CMS-driven | P2 |
| Gallery editor (upload, caption, reorder, publish) | P2 |
| Gallery public page | P2 |
| Events editor | P2 |
| Events public page | P2 |
| Announcements editor | P2 |
| Announcements banner on homepage | P2 |
| Social links editor | P2 |
| Social links in footer | P2 |
| Next.js cache invalidation on CMS save | P1 |
| SEO metadata per page | P3 |
| E2E test: admin changes InstaPay number; customer sees new number on checkout | P1 |
| E2E test: admin publishes announcement; it appears on homepage | P2 |

**Definition of Done:** A complete content-managed website where every public-facing text element, phone number, and image is editable by the admin without touching code.

---

### Milestone 6: Security Hardening and Launch Preparation (Week 15–16)
**Goal:** System is production-ready. Security validated. Performance verified. Documentation complete.

| Task | Priority |
|------|----------|
| Full security headers review and testing (securityheaders.com scan) | P1 |
| OWASP ZAP baseline scan on staging | P1 |
| Semgrep static analysis — resolve all high findings | P1 |
| Manual Burp Suite testing of booking flow, admin, file upload | P1 |
| `npm audit` — resolve all critical/high vulnerabilities | P1 |
| gitleaks scan of full git history | P1 |
| Lighthouse audit on all key pages (target: ≥ 85 mobile) | P1 |
| Full E2E test suite run on staging | P1 |
| Backup and restore procedure test | P1 |
| Production database migration dry run | P1 |
| Load test: 100 concurrent users (k6 or Artillery) | P2 |
| Privacy policy page | P1 |
| Update README with setup, deployment, and operations docs | P1 |
| Admin onboarding documentation (how to approve a booking, manage pricing) | P1 |
| Production deploy | P1 |
| Post-deployment smoke test (manual booking + admin approval) | P1 |
| UptimeRobot monitors configured | P1 |
| Sentry alert rules configured | P1 |

**Definition of Done:** Production deployment is live. A real booking can be created, paid via InstaPay, proof uploaded, and approved by admin end-to-end. All security scans pass with no critical/high findings.

---

## 3. Risk-Adjusted Schedule Notes

| Risk | Impact | Mitigation |
|------|--------|-----------|
| PostgreSQL exclusion constraint requires btree_gist extension not available on Hostinger VPS | M3 milestone delay | Verify extension availability in Milestone 0; fallback: application-level `SELECT FOR UPDATE` only |
| Cloudflare R2 setup takes longer than expected | M1 delay | Fall back to local disk for dev/staging; migrate to R2 before production |
| CMS scope expands during development | M5 delay | Strict scope control; additional CMS fields are always additive |
| Security scan reveals architectural issues | M6 delay | Early security review in M3 (not only M6) reduces late-stage surprises |

---

## 4. Development Standards

| Standard | Requirement |
|----------|-------------|
| Every feature branch requires a pull request | Mandatory |
| PRs require: type check pass + lint pass + unit tests pass | Mandatory |
| No secrets in Git (enforced by pre-commit hook) | Mandatory |
| All database changes via Drizzle migration (no manual SQL on production) | Mandatory |
| Every new API route has integration test coverage | Mandatory |
| Mobile-first CSS (start mobile, add breakpoints for desktop) | Mandatory |
| TypeScript strict mode (`"strict": true` in tsconfig) | Mandatory |
