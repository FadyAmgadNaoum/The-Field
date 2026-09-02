# Risks and Mitigations
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. Risk Assessment Framework

Each risk is rated on two dimensions:
- **Likelihood:** Low / Medium / High
- **Impact:** Low / Medium / High / Critical

**Risk Priority = Likelihood × Impact**

| Priority | Description |
|----------|-------------|
| P1 | High likelihood + High/Critical impact — must have a mitigation plan |
| P2 | Medium likelihood + High impact OR High likelihood + Medium impact |
| P3 | Low likelihood + High impact OR Medium likelihood + Medium impact |
| P4 | Low impact regardless of likelihood |

---

## 2. Technical Risks

### R-TECH-001: PostgreSQL Exclusion Constraint Unavailable
**Category:** Technical  
**Likelihood:** Low  
**Impact:** Critical  
**Priority:** P2

**Description:** The `btree_gist` PostgreSQL extension required for exclusion constraints may not be installable on the Hostinger VPS PostgreSQL installation (e.g., if using a managed DB with restricted extensions).

**Consequences if unremediated:** The database-level double-booking guard is absent. Only application-level `SELECT FOR UPDATE` protects against race conditions. A bug in application logic could result in double bookings.

**Mitigation:**
1. Verify `btree_gist` availability in Milestone 0 by running `CREATE EXTENSION btree_gist;` on the Hostinger database.
2. If unavailable: use strict `SERIALIZABLE` isolation level with `SELECT ... FOR UPDATE` as the sole concurrency guard.
3. Add compensating integration tests that specifically test concurrent booking under this fallback scenario.
4. Document clearly which guard is active in the deployment runbook.

**Early warning:** Milestone 0 database setup step fails.

---

### R-TECH-002: node-cron Job Silently Fails
**Category:** Technical  
**Likelihood:** Medium  
**Impact:** Medium  
**Priority:** P2

**Description:** The booking expiry job runs inside the Node.js process. If PM2 restarts the process, the cron job restarts too — but any expiry due during the restart window is missed until the next interval (up to 15 minutes).

**Consequences if unremediated:** Expired pending bookings hold their slot for up to 15 extra minutes. Customers may see a slot as unavailable when it should be free.

**Mitigation:**
1. The expiry job also runs at admin booking approval time (belt-and-suspenders): when an admin tries to approve a booking, the availability check runs fresh regardless of expired bookings in the DB.
2. The 15-minute delay is acceptable for V1 — document this limitation.
3. Add a Sentry alert if the cron job has not run in 20 minutes (heartbeat monitoring).
4. For V2, replace with BullMQ + Redis for reliable job scheduling.

---

### R-TECH-003: Next.js App Router RSC Caching Stale CMS Content
**Category:** Technical  
**Likelihood:** Medium  
**Impact:** Low  
**Priority:** P3

**Description:** Next.js RSC cache may serve stale CMS content (e.g., an old InstaPay number) for seconds or minutes after an admin update if cache invalidation does not work correctly.

**Consequences if unremediated:** Customers could see an outdated InstaPay number for a brief period, causing payment confusion.

**Mitigation:**
1. Tag all CMS cache with `revalidateTag('cms-{venueId}')` and call `revalidateTag` explicitly on every CMS save in the admin API.
2. Set a low `revalidate` fallback time (e.g., 60 seconds) so stale content is never served for more than 1 minute even if cache invalidation fails.
3. Test cache invalidation in E2E: change InstaPay number, load public page, verify new number appears.

---

### R-TECH-004: File Storage Data Loss (Local Disk Fallback)
**Category:** Technical  
**Likelihood:** Low (if using R2 from day 1)  
**Impact:** High  
**Priority:** P2 if using local disk; P4 if using R2

**Description:** If files are stored on the VPS local disk and the VPS is rebuilt or disk fails, all payment proofs and gallery images are lost permanently.

**Consequences if unremediated:** Loss of evidence for paid-and-confirmed bookings; legal and financial dispute risk.

**Mitigation:**
1. Use Cloudflare R2 object storage from day 1 in production (not local disk).
2. If local disk is used temporarily: add a daily rsync backup of the uploads directory to a remote location.
3. R2 has built-in redundancy — data loss risk is effectively eliminated.
4. Document the local disk fallback as "temporary development only."

---

### R-TECH-005: PM2 Process Not Starting After VPS Reboot
**Category:** Technical  
**Likelihood:** Low  
**Impact:** High  
**Priority:** P2

**Description:** If `pm2 startup` and `pm2 save` are not configured, the application will not start after a VPS reboot (e.g., following Hostinger maintenance).

**Consequences if unremediated:** Site downtime until a developer manually SSHs in and starts PM2.

**Mitigation:**
1. Run `pm2 startup` and `pm2 save` as part of the initial setup (Milestone 0 checklist).
2. UptimeRobot alerts within 5 minutes of downtime — fast detection.
3. Include reboot recovery procedure in the operations runbook.

---

## 3. Business Risks

### R-BIZ-001: Manual Payment Review Bottleneck
**Category:** Business  
**Likelihood:** High  
**Impact:** Medium  
**Priority:** P1

**Description:** The admin must manually review every payment proof before a booking is confirmed. During peak hours (Friday/Saturday evenings), multiple bookings may be submitted simultaneously. If the admin is not actively monitoring the dashboard, bookings remain in `payment_submitted` status for an extended period, causing customer anxiety and potential WhatsApp inquiries.

**Consequences if unremediated:** Poor customer experience, loss of trust, increased admin workload via WhatsApp.

**Mitigation:**
1. Admin dashboard shows a persistent "X pending requests" banner visible on every page.
2. Design the approval workflow for speed: the admin should be able to verify and approve in under 30 seconds per booking.
3. Establish an SLA (e.g., "bookings reviewed within 2 hours") visible to customers on the payment instructions screen.
4. Admin onboarding documentation must emphasize monitoring during operating hours.
5. V2 priority: WhatsApp notification to admin on new booking submission.

---

### R-BIZ-002: Fraudulent Payment Proofs
**Category:** Business  
**Likelihood:** Medium  
**Impact:** High  
**Priority:** P1

**Description:** A customer uploads a fake, edited, or recycled screenshot of an old InstaPay transfer as their payment proof. The admin may not immediately recognize the fraud.

**Consequences if unremediated:** Court time given to a customer who has not paid; financial loss to the venue.

**Mitigation:**
1. Admin training: what a genuine InstaPay confirmation looks like (transaction reference number, recipient name matching the venue, correct amount, recent timestamp).
2. Clearly display the booking's expected price next to the proof — if the proof shows a different amount, the admin will notice.
3. Provide predefined rejection reasons including "Payment appears fraudulent."
4. The system records the IP address of the proof upload for dispute documentation.
5. Future V2: InstaPay API integration would eliminate this risk entirely.

---

### R-BIZ-003: Administrator Credential Compromise
**Category:** Security / Business  
**Likelihood:** Low  
**Impact:** Critical  
**Priority:** P1

**Description:** An admin's email/password is compromised (phishing, weak password, reuse from another breach). An attacker gains access to the admin dashboard and can approve fraudulent bookings, reject legitimate ones, or access customer data.

**Consequences if unremediated:** Data breach, financial fraud, operational disruption, reputational damage.

**Mitigation:**
1. Enforce strong passwords (minimum 8 characters) at application level.
2. Admin training: use a unique password for this system; do not share credentials.
3. Brute-force protection: 5 failed attempts → 15-minute lockout.
4. Session invalidation: super_admin can immediately deactivate a compromised account.
5. Audit logs: all actions taken with a compromised account are visible for forensic review.
6. V2 priority: Add TOTP-based multi-factor authentication.

---

### R-BIZ-004: Out-of-Scope Scope Creep During Development
**Category:** Business / Project  
**Likelihood:** High  
**Impact:** Medium  
**Priority:** P1

**Description:** Stakeholders request features outside the defined V1 scope during development (online payments, SMS notifications, loyalty program, multi-court bulk booking, etc.). Each addition delays the launch.

**Consequences if unremediated:** Delayed launch, overrun budget, reduced quality of in-scope features due to time pressure.

**Mitigation:**
1. This specification is the agreed V1 scope. Any addition requires explicit sign-off and an updated timeline estimate.
2. Maintain a "Future Backlog" document where out-of-scope ideas are recorded but not scheduled.
3. Weekly stakeholder check-ins to review scope boundary.
4. "Out of Scope — Deferred to V2" section in each meeting's notes.

---

### R-BIZ-005: Egyptian ISP or Infrastructure Issues
**Category:** Infrastructure / External  
**Likelihood:** Medium  
**Impact:** Medium  
**Priority:** P2

**Description:** Egyptian internet infrastructure occasionally experiences degraded international connectivity. If the VPS is hosted outside Egypt (Hostinger's European/US data centers), latency from Egypt may be noticeable. If InstaPay's system is down, customers cannot complete payments.

**Consequences if unremediated:** Slow page loads for Egyptian users; bookings cannot be completed during InstaPay outages.

**Mitigation:**
1. Choose a Hostinger VPS location closest to Egypt (likely Netherlands or Frankfurt — typically ~60ms from Cairo, acceptable for web use).
2. The static/SSR architecture minimizes API round trips needed for page loads.
3. InstaPay outage: the booking can be started and the proof uploaded later via the late upload mechanism. Customer instructions mention this option.
4. Consider Cloudflare proxying (free plan) in front of the VPS to improve global performance and add DDoS protection.

---

## 4. Operational Risks

### R-OPS-001: No Developer Available During Incident
**Category:** Operational  
**Likelihood:** Medium  
**Impact:** High  
**Priority:** P2

**Description:** The site goes down outside business hours or when the developer is unavailable. The venue administrator is not technical and cannot diagnose or fix application-level issues.

**Mitigation:**
1. PM2 auto-restart handles most crash scenarios without human intervention.
2. UptimeRobot alerts the developer via email and SMS within 5 minutes.
3. Provide admin with a simple escalation runbook: "If the site is down, send [developer's name] an SMS. Do not attempt to restart anything yourself."
4. In a true emergency (prolonged outage), the venue falls back to WhatsApp booking manually — operationally degraded but not catastrophically broken.

---

### R-OPS-002: Database Backup Not Verified
**Category:** Operational  
**Likelihood:** Medium  
**Impact:** Critical  
**Priority:** P1

**Description:** Backups are scheduled but never tested. When a restore is needed (VPS failure, accidental data deletion), the backup is found to be corrupt or incomplete.

**Mitigation:**
1. Test the backup and restore procedure before launch (Milestone 6 checklist).
2. Perform a test restore monthly on the staging environment.
3. Backup script logs its completion/failure; failures are emailed to the developer.
4. Backups are uploaded to R2 for off-site redundancy.

---

### R-OPS-003: Secret Rotation Not Documented
**Category:** Operational  
**Likelihood:** Medium  
**Impact:** Medium  
**Priority:** P2

**Description:** Environment variables (SESSION_SECRET, S3 keys, etc.) are not rotated regularly. If a key is compromised and not rotated promptly, an attacker retains access.

**Mitigation:**
1. Document the key rotation procedure in the ops runbook.
2. Rotating `SESSION_SECRET` logs out all active admin sessions — document this user impact.
3. Schedule a 6-month reminder to review and rotate credentials.
4. R2 access keys support IP restrictions — apply if VPS IP is static.

---

## 5. Risk Register Summary

| ID | Risk | Priority | Milestone Where Addressed |
|----|------|----------|--------------------------|
| R-TECH-001 | btree_gist unavailable | P2 | Milestone 0 |
| R-TECH-002 | Cron job silent failure | P2 | Milestone 1 |
| R-TECH-003 | RSC cache stale | P3 | Milestone 5 |
| R-TECH-004 | File storage data loss | P2 | Milestone 0 (storage choice) |
| R-TECH-005 | PM2 not starting on reboot | P2 | Milestone 0 + 6 |
| R-BIZ-001 | Manual payment bottleneck | P1 | Design + Admin UX |
| R-BIZ-002 | Fraudulent proofs | P1 | Admin training + UX |
| R-BIZ-003 | Admin credential compromise | P1 | Security design + training |
| R-BIZ-004 | Scope creep | P1 | Project governance |
| R-BIZ-005 | Egypt ISP / InstaPay outages | P2 | Architecture + UX |
| R-OPS-001 | No developer during incident | P2 | Operations runbook |
| R-OPS-002 | Backup never tested | P1 | Milestone 6 checklist |
| R-OPS-003 | Secret rotation not done | P2 | Operations runbook |

---

## 6. Residual Risk Statement

After all mitigations are applied, the following residual risks are accepted for V1:

1. **No MFA on admin accounts.** Accepted for V1 given the small admin team and compensating controls (rate limiting, session revocation, audit logs). MFA is a V2 priority.
2. **Manual payment verification.** This is a design choice for V1, not a risk to mitigate. The process is documented clearly and the admin workflow is optimized for speed.
3. **Single VPS — no failover.** Accepted at V1 scale. 99.5% uptime target is achievable with PM2 auto-restart and good ops practices. Active-passive failover is a future infrastructure investment.
4. **No DDoS protection beyond NGINX rate limiting.** A determined DDoS attack could overwhelm the VPS. Adding Cloudflare proxy (free) as a first defense is strongly recommended but not strictly required for V1 launch.
