# The Field — Padel Court Booking Website
## Specification Index
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Complete — Ready for Implementation

---

## Document Index

| # | Document | Description |
|---|----------|-------------|
| 01 | [Product Requirements Document](./01-product-requirements-document.md) | Business context, objectives, scope, personas, constraints, assumptions, open questions |
| 02 | [Functional Requirements](./02-functional-requirements.md) | All FR-CUS, FR-BKG, FR-PAY, FR-ADM, FR-CMS, FR-SEC requirements |
| 03 | [Non-Functional Requirements](./03-non-functional-requirements.md) | Performance, availability, scalability, security, maintainability, usability, accessibility, compliance |
| 04 | [System Architecture](./04-system-architecture.md) | Modular monolith structure, module boundaries, concurrency strategy, technology justification |
| 05 | [Database Architecture](./05-database-architecture.md) | Full PostgreSQL schema, indexes, constraints, exclusion constraint for booking integrity, migrations |
| 06 | [Booking State Machine](./06-booking-state-machine.md) | All booking and payment states, transition rules, actors, expiry logic, concurrent approval handling |
| 07 | [Payment Verification Workflow](./07-payment-verification-workflow.md) | InstaPay manual payment flow, customer journey, admin verification steps, edge cases |
| 08 | [Admin Workflow](./08-admin-workflow.md) | All admin dashboard workflows: login, booking management, court/pricing/schedule management, CMS, audit logs |
| 09 | [CMS Architecture](./09-cms-architecture.md) | Content inventory, key-value settings, collection types, service design, cache invalidation |
| 10 | [Authentication and Authorization Model](./10-authentication-authorization-model.md) | Admin session (iron-session), customer identity verification, RBAC, permission matrix, security properties |
| 11 | [API Architecture](./11-api-architecture.md) | All public and admin API routes, request/response shapes, validation, error codes, rate limits |
| 12 | [Storage Architecture](./12-storage-architecture.md) | S3/R2 object storage, private vs public files, signed URLs, upload pipeline, file validation |
| 13 | [Security Threat Model](./13-security-threat-model.md) | STRIDE/OWASP analysis of 18 threats, mitigations, residual risks, security testing plan |
| 14 | [Testing Strategy](./14-testing-strategy.md) | Unit, integration, E2E, security test plans with concrete test cases and coverage targets |
| 15 | [Deployment Architecture](./15-deployment-architecture.md) | Hostinger VPS, NGINX, PM2, PostgreSQL, Let's Encrypt, CI/CD, deployment scripts, backup |
| 16 | [Monitoring Strategy](./16-monitoring-strategy.md) | Sentry, UptimeRobot, structured logging, DB monitoring, incident response runbooks |
| 17 | [Future Scalability Strategy](./17-future-scalability-strategy.md) | V1 decisions that preserve multi-venue migration, evolution path, technical debt inventory |
| 18 | [Implementation Roadmap](./18-implementation-roadmap.md) | 6 milestones over 14–16 weeks, task breakdown, definition of done, development standards |
| 19 | [Acceptance Criteria](./19-acceptance-criteria.md) | Concrete, testable launch criteria for all functional areas + launch readiness checklist |
| 20 | [Risks and Mitigations](./20-risks-and-mitigations.md) | Technical, business, and operational risks with priority ratings and mitigation plans |
| 21 | [**Architecture Review Report**](./21-architecture-review-report.md) | **Pre-implementation review: 7 required changes, security findings, booking integrity analysis, open business decisions, Definition of Done** |
| 22 | [**Implementation Blueprint**](./22-implementation-blueprint.md) | **Final coding agent handoff: architecture, directory structure, all 19 implementation plans, milestone roadmap, complete task breakdown (M0–M6), quality gates, Definition of Done** |
| 23 | [**Production Reliability and Scalability Architecture**](./23-production-reliability-architecture.md) | **HA architecture, SPOF analysis, load testing plan, disaster recovery, backup strategy, failure modes, Hostinger compatibility, cost-aware deployment tiers, updated monitoring, deployment strategy, reliability implementation tasks, updated quality gates, authoritative Definition of Done** |

---

## Key Design Decisions at a Glance

| Decision | Rationale |
|----------|-----------|
| Next.js 14 (App Router) modular monolith | Single repo, SSR for SEO, API routes avoid separate backend, right-sized for 1–2 developers |
| PostgreSQL exclusion constraints for booking integrity | Database-enforced double-booking prevention; no application bug can bypass it |
| Manual InstaPay payment (no gateway) | V1 constraint; architecture supports future gateway addition |
| Customer authentication before booking submission | Public browsing remains open; Google Sign-In or email/password creates the account that owns each booking |
| iron-session (not NextAuth/JWT) | Simple, no external dependency, per-user session revocation |
| Venue-aware schema from day 1 | Clean migration path to multi-venue without rewriting the booking engine |
| node-cron inside process (not Redis/BullMQ) | No extra infrastructure; adequate for V1 single-process deployment |
| Drizzle ORM over Prisma | TypeScript-first, thin, raw SQL access for complex locking queries |
| Cloudflare R2 for storage | Zero egress fees; S3-compatible; private bucket for proofs, public for media |

---

## Open Business Decisions — Require Venue Owner Confirmation Before Development

The following decisions have NO confirmed default. Development of features that depend on them must not begin until the venue owner provides an answer.

| # | Decision | Impact If Unresolved | Required Before |
|---|----------|---------------------|-----------------|
| OBD-001 | Cancellation policy — can customers self-cancel? If yes, up to how many hours before the booking? | Booking state machine, customer-facing API | Milestone 3 |
| OBD-002 | Pending booking expiry timeout — how long should the system hold a court slot for a non-paying customer? | Availability logic, expiry job configuration | Milestone 1 |
| OBD-003 | Language for Version 1 — English only, Arabic only, or bilingual? | Entire customer-facing UI, RTL CSS, i18n library | **Milestone 2 (BLOCKING)** |
| OBD-004 | Exact operating schedule — which days is the venue open, and what are the opening and closing times? | Database seed, date picker behaviour | **Milestone 0 (BLOCKING)** |
| OBD-005 | Indefinite soft-hold acceptance — the venue owner must acknowledge that `payment_submitted` bookings hold their slot until an admin acts, with no automatic release | Admin operations | Milestone 1 |

**These are business policy decisions, not technical ones. They cannot be decided by the development team.**
