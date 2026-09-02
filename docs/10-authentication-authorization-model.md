# Authentication and Authorization Model
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. Authentication Scope

Version 1 has two distinct authentication contexts:

| Context | Who | Mechanism | Session Storage |
|---------|-----|-----------|-----------------|
| **Admin Authentication** | Venue administrators | Email + password → server session | Encrypted cookie (iron-session) |
| **Customer Authentication** | Customers submitting bookings | Google Sign-In or email/password → server session | Encrypted cookie (iron-session) |

**Public browsing does not require authentication.** The website home page, courts listing, pricing page, availability calendar, gallery, FAQs, and contact page are all accessible to any visitor without signing in.

**Authentication is mandatory before a customer can submit a booking.** A customer may browse and select a court, date, and time slot without signing in, but the booking submission step requires a valid customer session. Unauthenticated `POST /api/v1/bookings` returns HTTP 401.

**Post-authentication revalidation is mandatory.** After the customer authenticates and returns to the booking flow, the server must revalidate court availability, operating hours, slot availability, and price before creating the booking record. The slot selection made before authentication is treated as the customer's intent, not as a guaranteed hold.

**Booking status lookup** uses the authenticated customer session to retrieve only the customer's own bookings. There is no anonymous reference + phone fallback.

---

## 2. Admin Authentication

### 2.1 Technology Choice: iron-session

**Why iron-session over NextAuth / Lucia / JWT:**
- Admin use case is simple: small number of users, single application, no OAuth providers needed.
- iron-session encrypts session data inside a signed cookie. The server does not need a session store (Redis, DB table for sessions). Session validity is determined by the cookie's HMAC signature.
- Session revocation (for deactivated admins) is handled by the `sessions_invalidated_at` field on the admin user record — the session middleware checks this timestamp on every request.
- No external service dependency. Works identically in development and production.

### 2.2 Session Structure

```typescript
// The data stored inside the encrypted cookie
interface AdminSession {
  adminId: string        // UUID
  roleId: string         // UUID
  issuedAt: number       // Unix timestamp (ms) — used for revocation check
}
```

### 2.3 Session Middleware

Every admin API route and admin page route passes through `withAdminSession`:

```typescript
// src/lib/auth/admin-session.ts

export async function getAdminSession(
  req: NextRequest
): Promise<AdminSession | null> {
  const session = await getIronSession<AdminSession>(req, res, sessionOptions)

  if (!session.adminId) return null

  // Check that the admin account is still active and session is not revoked
  const admin = await adminRepo.findById(session.adminId)

  if (!admin) return null
  if (!admin.is_active) return null
  if (
    admin.sessions_invalidated_at &&
    session.issuedAt < admin.sessions_invalidated_at.getTime()
  ) {
    return null  // Session was issued before invalidation — treat as expired
  }

  return session
}
```

This check runs on every protected request. It adds one DB query but ensures that deactivating an admin takes effect immediately on their next API call, without waiting for cookie expiry.

### 2.4 Session Configuration

```typescript
const sessionOptions: SessionOptions = {
  cookieName: 'thefield_admin_session',
  password: process.env.SESSION_SECRET,  // min 32 chars, from env var
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    path: '/admin',    // cookie scoped to /admin path only
    maxAge: 60 * 60 * 8,  // 8 hours
  },
}
```

**SESSION_SECRET rotation:** If the secret is rotated, all existing sessions are immediately invalidated (everyone is logged out). This is the nuclear revocation option for security incidents. Document this in the ops runbook.

### 2.5 Password Policy

- bcrypt with cost factor 12 minimum.
- Minimum 8 characters (enforced at application layer).
- No maximum length limitation (bcrypt handles long passwords by truncating at 72 bytes; document this limit to avoid silent truncation issues with very long passwords — use a length check: max 72 chars for bcrypt inputs or pre-hash with SHA-256).
- Passwords are never logged, returned in API responses, or stored in plain text.
- Temporary passwords (for new admins) must be changed on first login (enforced by a `must_change_password` flag on the admin record).

### 2.6 Brute-Force Protection

Rate limiting is implemented at the NGINX layer (primary) and application layer (secondary):

```nginx
# NGINX config
limit_req_zone $binary_remote_addr zone=admin_login:10m rate=5r/m;
location /api/v1/admin/auth/login {
    limit_req zone=admin_login burst=3 nodelay;
}
```

Application layer (in addition to NGINX):

```typescript
// In-memory rate limiter using 'rate-limiter-flexible'
const loginLimiter = new RateLimiterMemory({
  points: 5,        // attempts
  duration: 15 * 60, // per 15 minutes
  blockDuration: 15 * 60,
})

// Key: IP address
// On failed login: consume 1 point
// On success: reset points for that IP
```

---

## 3. Customer Authentication and Identity

### 3.1 Customer Session

Customers authenticate using one of two methods:

- **Google Sign-In** — OAuth 2.0 via the Google provider. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from environment variables.
- **Email/password** — bcrypt-hashed at cost factor 12. Same brute-force protection as admin login (5 failures per IP per 15 minutes).

Customer sessions use iron-session with a separate cookie from admin sessions:

```typescript
const customerSessionOptions: SessionOptions = {
  cookieName: 'thefield_customer_session',
  password: process.env.SESSION_SECRET!,
  cookieOptions: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    path:     '/',   // scoped to all public routes, NOT /admin
    maxAge:   60 * 60 * 24 * 7,  // 7 days
  },
}

interface CustomerSession {
  customerId: string      // UUID from customer_accounts.id
  email:      string      // customer's email address
  issuedAt:   number      // Unix timestamp — for future revocation if needed
}
```

### 3.2 Booking Flow Authentication Gate

A customer may browse the website, view courts, view pricing, and select a slot without authenticating. When they attempt to proceed to the booking submission form, the system checks for a valid session:

```
Customer selects court → selects date → selects time slot
          │
          ▼
Customer proceeds to booking form
          │
          ▼
getCustomerSession() called
          │
    ┌─────┴──────┐
    │ session?   │
    No           Yes
    │             │
    ▼             ▼
Redirect to   Show booking
/signin?      form with
redirect=/book pre-populated
?courtId=...  court/date/slot
&date=...
&startTime=...
          │
          ▼
After sign-in or sign-up:
  Redirect back to /book with preserved query params
          │
          ▼
Server revalidates:
  • Court still active
  • Date still operational
  • Slot still available
  • Price recalculated from DB
  • Customer account ID from session (never from request body)
```

### 3.3 Booking Status Lookup

Authenticated customers access their booking history directly via their session. The booking status page requires a customer session:

```
GET  /api/v1/customer/bookings                     (requires customer session)
POST /api/v1/booking-status                        (requires customer session; reference is scoped to that session)
```

These endpoints return friendly status labels and no internal IDs or admin notes. On a different device, the customer signs in again; a booking reference never grants access by itself.

### 3.4 Proof Upload Authorization

Payment proof upload for an existing booking requires a valid customer session where `session.customerId` matches the booking's `customer_account_id`.

```
POST /api/v1/bookings/proof
  { reference, file }

Authorization check:
  Customer session present AND session.customerId = booking.customer_account_id
```

### 3.5 IDOR Protection

- Authenticated customers access only their own bookings. The server joins `bookings` to `customer_accounts` on `customer_account_id` and verifies the session's `customerId` matches.
- No internal UUIDs (booking ID, customer account ID) are returned to customers in any API response. Only the booking reference is shared.

---

## 4. Authorization Model (RBAC)

### 4.1 Design

Role-Based Access Control. Each admin has exactly one role. Each role has a set of permissions. Permissions are strings checked at the service layer.

```
admin_users
    │ (many-to-one)
    ▼
admin_roles
    │ (one-to-many)
    ▼
admin_role_permissions
    (role_id, permission_string)
```

### 4.2 Predefined Roles

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| `super_admin` | Full access. Can manage admins, view all data, change all settings. | All permissions |
| `admin` | Day-to-day booking operations. Cannot manage admins. | All except `manage_admins` |
| `viewer` | Read-only access. Can view bookings, customers, audit logs. | `view_bookings`, `view_payment_proof`, `manage_customers`, `view_audit_logs` |

### 4.3 Permission Check Implementation

```typescript
// src/lib/auth/permissions.ts

export async function requirePermission(
  session: AdminSession,
  permission: string
): Promise<void> {
  const permissions = await permissionsRepo.getPermissionsForRole(session.roleId)

  if (!permissions.includes(permission)) {
    throw new ForbiddenError(
      `Permission '${permission}' is required for this action.`
    )
  }
}
```

Usage in API route handler:

```typescript
// src/app/api/v1/admin/bookings/[id]/approve/route.ts

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getAdminSession(req)
  if (!session) return unauthorized()

  await requirePermission(session, 'approve_booking')
  await requirePermission(session, 'verify_payment')

  const result = await bookingService.approveBooking(params.id, session.adminId)

  if (!result.success) return apiError(result.error)
  return apiSuccess(result.booking)
}
```

**Permissions are never checked on the frontend only.** The UI may hide buttons to improve UX, but every API route independently verifies permissions server-side.

### 4.4 Venue Scoping

In V1 there is one venue. However, all admin queries include a `venue_id` filter derived from the server-side configuration (`VENUE_ID` env var), not from the client request. This prevents a future multi-venue scenario where an admin from Venue A could accidentally (or maliciously) access Venue B's data.

```typescript
// src/lib/config.ts
export const venue = {
  id: process.env.VENUE_ID!,  // Set at deployment time
  slug: process.env.VENUE_SLUG ?? 'the-field',
}
```

Every service function that reads or writes venue-specific data takes `venueId` as an explicit parameter sourced from this config.

---

## 5. Security Properties

### 5.1 IDOR Prevention

Customer-facing booking queries require a customer session and filter `bookings.customer_account_id` by the session's `customerId`. A customer cannot access booking data belonging to another account.

Admin access: All admin queries are scoped to `venue_id`. Admin A cannot access data from Venue B (relevant for future multi-venue).

Internal UUIDs (booking ID, customer ID) are never exposed to customers. Only the booking reference is shared.

### 5.2 Privilege Escalation Prevention

- An admin cannot assign themselves a higher role.
- The `manage_admins` permission is required to create or modify admin accounts.
- Role assignments are audited.
- The initial super_admin account is seeded during deployment; it cannot be deleted if it is the only active super_admin.

### 5.3 Session Fixation Prevention

- iron-session generates a new session on every login (the old cookie is overwritten).
- The `issuedAt` timestamp ensures old sessions cannot be replayed after `sessions_invalidated_at` is set.

### 5.4 CSRF Protection

For admin API routes that mutate state:
- All mutation routes use `POST`, `PATCH`, or `DELETE` methods.
- `SameSite=Lax` on the session cookie is the **primary CSRF defence**. For cross-origin requests from a different site, the browser will not attach the session cookie on a top-level POST navigation.
- All admin mutation routes require `Content-Type: application/json`. A cross-origin HTML form cannot set this header — only JavaScript `fetch()` or `XMLHttpRequest` can. This is an effective secondary defence.
- Note: `X-Requested-With` is NOT used as a CSRF control. The `fetch()` API does not automatically add this header, and its absence from some requests would cause false failures. `SameSite=Lax` + `Content-Type` enforcement is the correct approach.

For customer-facing forms:
- The booking submission form includes a CSRF token (generated per page load, stored in the session or a separate signed cookie).

### 5.5 Security Headers

Applied globally via Next.js middleware:

```typescript
// src/middleware.ts (applied to all routes)
const securityHeaders = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'nonce-{NONCE}' https://sentry.io",
    "style-src 'self' 'unsafe-inline'",   // Tailwind requires this; tighten if possible
    "img-src 'self' data: https:",
    "connect-src 'self' https://sentry.io",
    "frame-ancestors 'none'",
  ].join('; '),
}
```

Note: The CSP `nonce` approach is used for any inline scripts (Sentry SDK injection). Every request generates a fresh nonce.

---

## 6. Multi-Factor Authentication (Future)

V1 does not implement MFA. The architecture supports adding TOTP-based MFA in a future version without restructuring the session model:

- Add `totp_secret` and `mfa_enabled` columns to `admin_users`.
- Add a second login step that validates the TOTP token before issuing the session.
- The `AdminSession` object can include an `mfaVerified: boolean` flag.

---

## 7. Authorization Decision Matrix

| Actor | Resource | Action | Allowed? | Condition |
|-------|----------|--------|----------|-----------|
| Unauthenticated visitor | Public pages (home, courts, pricing, gallery, FAQs) | View | ✓ | No authentication required |
| Unauthenticated visitor | Availability calendar | View | ✓ | No authentication required |
| Unauthenticated visitor | Booking submission | Submit | ✗ | Must sign in first — returns 401 |
| Customer (authenticated) | Booking submission | Submit | ✓ | Valid customer session required |
| Customer (authenticated) | Own booking status | View | ✓ | Session `customerId` matches booking |
| Customer (authenticated) | Another customer's booking | View | ✗ | Never — session scoping prevents this |
| Customer (authenticated) | Any booking | Approve | ✗ | Never |
| Customer (authenticated) | Own payment proof | Upload | ✓ | Session `customerId` matches booking |
| Customer (any) | Admin dashboard | Any | ✗ | Never |
| Admin (viewer) | Booking list | View | ✓ | `view_bookings` permission |
| Admin (viewer) | Booking | Approve | ✗ | Lacks `approve_booking` |
| Admin (admin) | Booking | Approve | ✓ | `approve_booking` + `verify_payment` |
| Admin (admin) | Admin accounts | Create | ✗ | Lacks `manage_admins` |
| Admin (super_admin) | All resources | All | ✓ | Full permissions |
| System (cron) | Expired bookings | Expire | ✓ | Runs as system; no admin session required |
