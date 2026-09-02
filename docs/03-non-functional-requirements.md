# Non-Functional Requirements
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## Notation

Each requirement is identified as **NFR-[category]-NNN**.

Categories:
- **PERF** — Performance
- **AVAIL** — Availability and Reliability
- **SCALE** — Scalability
- **SEC** — Security
- **MAINT** — Maintainability
- **USE** — Usability
- **ACC** — Accessibility
- **DATA** — Data Integrity and Consistency
- **COMP** — Compliance
- **OPS** — Operational

---

## 1. Performance

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-PERF-001 | The booking availability page must respond within 500ms for 95% of requests under normal load. | p95 < 500ms |
| NFR-PERF-002 | The booking submission endpoint must respond within 1000ms for 95% of requests. | p95 < 1000ms |
| NFR-PERF-003 | All customer-facing page loads (HTML + assets) must complete within 3 seconds on a 4G connection (10 Mbps). | LCP < 3s |
| NFR-PERF-004 | The admin dashboard must respond within 1 second for list views under normal admin load. | p95 < 1000ms |
| NFR-PERF-005 | Database queries for availability checking must complete in under 100ms with appropriate indexes. | < 100ms |
| NFR-PERF-006 | Payment proof upload must handle files up to 10MB without timeout under normal conditions. | Timeout > 30s |
| NFR-PERF-007 | Lighthouse mobile performance score must be ≥ 85 for the home and booking pages. | Score ≥ 85 |
| NFR-PERF-008 | Time to First Byte (TTFB) for server-rendered pages must be under 400ms. | TTFB < 400ms |

**Why these targets:** The primary customer segment uses mobile devices on Egyptian 4G networks. Slow load times directly reduce booking conversion. The booking and availability endpoints are on the critical path and must feel instantaneous.

---

## 2. Availability and Reliability

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-AVAIL-001 | The website must target 99.5% uptime (allowing ~44 hours downtime/year). | 99.5% |
| NFR-AVAIL-002 | Planned maintenance must be schedulable without data loss. Downtime must be communicated via a maintenance page. | — |
| NFR-AVAIL-003 | The application must recover automatically from a crash without manual intervention (process manager: PM2 or equivalent). | Auto-restart |
| NFR-AVAIL-004 | A database backup must be executed at least daily and retained for a minimum of 30 days. | Daily backup, 30-day retention |
| NFR-AVAIL-005 | The system must handle a Hostinger VPS reboot without losing any confirmed booking data. | Zero data loss on restart |
| NFR-AVAIL-006 | Any unhandled server error must be captured by the monitoring system (Sentry) and must not expose error details to the client. | — |

**Why 99.5%:** The venue is a single-location operation and the booking load is not 24/7 critical infrastructure. 99.5% is realistic for a Hostinger VPS deployment and appropriate for the scale. Reaching 99.9% would require more expensive infrastructure not justified in V1.

---

## 3. Scalability

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-SCALE-001 | The application must handle at least 100 concurrent users without degradation. | 100 concurrent |
| NFR-SCALE-002 | The database must support at least 10,000 booking records without query degradation (with proper indexes). | 10K records |
| NFR-SCALE-003 | The system architecture must allow vertical scaling (upgrading the Hostinger VPS) without code changes. | — |
| NFR-SCALE-004 | The storage layer must support at least 5,000 uploaded payment proof files in V1. | 5,000 files |
| NFR-SCALE-005 | The application must be stateless (session data in DB or secure server-side store) so that a future load balancer can be added without code changes. | Stateless app |

**Why modular monolith over microservices:** At V1 scale (1 venue, 2–4 courts, ~10–50 bookings/day), microservices would add deployment complexity, latency, and operational overhead that a small team cannot efficiently maintain. A well-structured monolith with clean module boundaries is easier to maintain and can be split later if genuine scale demands it.

---

## 4. Security

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-SEC-001 | All traffic must be served over HTTPS with TLS 1.2 minimum (TLS 1.3 preferred). | TLS ≥ 1.2 |
| NFR-SEC-002 | Security headers must score B or higher on securityheaders.com. | Grade ≥ B |
| NFR-SEC-003 | Dependency vulnerabilities must be scanned on every deployment using `npm audit` or equivalent. | 0 critical CVEs |
| NFR-SEC-004 | Static code security scanning (Semgrep) must be part of the CI pipeline. | 0 high findings unaddressed |
| NFR-SEC-005 | OWASP Top 10 risks must be explicitly addressed in the security threat model. | All 10 addressed |
| NFR-SEC-006 | Administrator passwords must be bcrypt-hashed with a cost factor of at least 12. | bcrypt cost ≥ 12 |
| NFR-SEC-007 | Brute-force protection must lock out or rate-limit login attempts (5 failures per 15 minutes). | Max 5 fails / 15 min |
| NFR-SEC-008 | Payment proof files must be inaccessible to unauthenticated users. | Access-controlled |
| NFR-SEC-009 | No secrets must be committed to the Git repository. | Pre-commit secret scan |
| NFR-SEC-010 | Input validation must be applied at both the API layer and the database constraint layer. | Dual validation |

---

## 5. Maintainability

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-MAINT-001 | The codebase must be written in TypeScript throughout (frontend and backend). | 100% TypeScript |
| NFR-MAINT-002 | All modules must have clearly defined interfaces; direct cross-module database access is not permitted (modules communicate through their own service layer). | — |
| NFR-MAINT-003 | The project must include a README with setup, environment configuration, and deployment instructions. | — |
| NFR-MAINT-004 | Database schema changes must be managed through a versioned migration system (Drizzle ORM migrations or equivalent). | — |
| NFR-MAINT-005 | Environment-specific configuration must use `.env` files and be documented in `.env.example`. | — |
| NFR-MAINT-006 | The codebase must achieve at least 70% unit test coverage on business-critical modules (booking engine, pricing, availability). | ≥ 70% coverage |
| NFR-MAINT-007 | ESLint and Prettier must be configured and enforced in the CI pipeline. | 0 lint errors on CI |
| NFR-MAINT-008 | No single function or module should exceed reasonable complexity limits (cyclomatic complexity ≤ 10 per function). | CC ≤ 10 |
| NFR-MAINT-009 | The business logic layer must be independent of the HTTP framework to enable testing without starting a server. | — |

**Why TypeScript throughout:** TypeScript eliminates entire classes of runtime errors — especially important for booking logic involving dates, prices, and status transitions. Type safety across the API boundary (using shared types between frontend and backend) prevents mismatches.

---

## 6. Usability

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-USE-001 | A first-time customer must be able to complete a booking in under 3 minutes without instructions. | Task completion < 3 min |
| NFR-USE-002 | All form validation errors must display next to the relevant field in plain Arabic-friendly language. | — |
| NFR-USE-003 | The booking confirmation screen must be printable and shareable (the customer's booking reference must be clearly visible). | — |
| NFR-USE-004 | The admin dashboard must allow an administrator to view, verify, and approve a booking in under 30 seconds. | Task < 30 sec |
| NFR-USE-005 | Destructive admin actions (cancel, reject) must require a confirmation dialog. | — |
| NFR-USE-006 | All data tables in the admin must support search, filter, and pagination. | — |
| NFR-USE-007 | The admin dashboard must display meaningful booking status labels (not raw database enum values). | — |
| NFR-USE-008 | The mobile booking flow must require no horizontal scrolling. | — |

---

## 7. Accessibility

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-ACC-001 | Customer-facing pages must meet WCAG 2.1 Level AA standards. | WCAG 2.1 AA |
| NFR-ACC-002 | All interactive elements must be keyboard navigable. | — |
| NFR-ACC-003 | All images must have meaningful alt text. | — |
| NFR-ACC-004 | Form inputs must have associated labels (not placeholder-only). | — |
| NFR-ACC-005 | Color contrast ratio must meet WCAG AA minimums (4.5:1 for normal text). | Contrast ≥ 4.5:1 |
| NFR-ACC-006 | The website HTML must use semantic elements (header, main, nav, article, section, footer). | — |
| NFR-ACC-007 | The website must be navigable with a screen reader (VoiceOver / NVDA). | — |

**Note:** Full WCAG compliance requires manual testing with assistive technologies and expert review. Automated tooling (axe-core) will be used during development to catch common violations, but it does not guarantee full compliance.

---

## 8. Data Integrity and Consistency

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-DATA-001 | No two approved bookings may exist for the same court, date, and overlapping time range — enforced at the database level. | DB constraint |
| NFR-DATA-002 | All booking state transitions must be atomic — partial updates are not permitted. | Transactions |
| NFR-DATA-003 | Prices stored on booking records must be immutable after booking creation. | Immutable field |
| NFR-DATA-004 | Soft deletion must be used for courts, pricing rules, and CMS content so that historical booking records remain intact. | Soft delete |
| NFR-DATA-005 | All timestamps must be stored in UTC. Timezone conversion for display is handled at the presentation layer. | UTC storage |
| NFR-DATA-006 | Database foreign key constraints must be enforced for all relationships. | FK constraints |
| NFR-DATA-007 | All booking records must retain their data even after cancellation or rejection (never hard-deleted). | — |
| NFR-DATA-008 | The audit log must be append-only — no update or delete operations are permitted on audit log rows. | Append-only |

---

## 9. Compliance

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-COMP-001 | Customer personal data (name, phone) must be stored in the primary database and not transmitted to third-party services without consent. | — |
| NFR-COMP-002 | The website must include a Privacy Policy page. | — |
| NFR-COMP-003 | If analytics cookies are used, a GDPR/cookie consent banner must appear. | — |
| NFR-COMP-004 | The system must not store raw InstaPay account numbers supplied by customers. The venue's own InstaPay number is stored as CMS content. | — |
| NFR-COMP-005 | Uploaded payment proof images must be treated as sensitive financial documents and access-controlled accordingly. | — |

---

## 10. Operational

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-OPS-001 | Application logs must be structured (JSON) and capture: timestamp, severity, request ID, route, duration, and error details. | — |
| NFR-OPS-002 | Error events must be forwarded to Sentry (or equivalent) with sufficient context for diagnosis. | — |
| NFR-OPS-003 | Deployment must be achievable via a single command or script from the GitHub repository. | — |
| NFR-OPS-004 | Environment variables must be documented in `.env.example` with descriptions. Actual secret values must never be in source control. | — |
| NFR-OPS-005 | Database migrations must be idempotent and runnable on deployment without manual intervention. | — |
| NFR-OPS-006 | The application must expose a `/health` endpoint returning HTTP 200 with basic status information for uptime monitoring. | — |
| NFR-OPS-007 | Backup and restore procedures must be documented. | — |
| NFR-OPS-008 | A booking expiry job must run at least every 15 minutes to expire stale pending bookings. | ≤ 15 min interval |
