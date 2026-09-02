# Future Scalability Strategy
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Reference Document — Not for V1 Implementation

---

## 1. Purpose

This document describes the architectural decisions made in V1 that deliberately preserve future scalability options, and the incremental steps required to evolve the system toward a multi-venue Padel booking platform.

**Important:** Nothing in this document is implemented in V1. This document exists so that developers can make V1 decisions with full awareness of where the system is headed.

---

## 2. The Future Vision

The Field may eventually become one venue inside a larger Padel booking platform where:

- Multiple Padel venues across Egypt (and possibly the region) can list their courts.
- Each venue has a venue owner who manages their own courts and bookings.
- A central platform administrator oversees all venues.
- Customers have accounts and can see their booking history.
- Online payment gateways replace the manual InstaPay process.
- Automated WhatsApp and SMS notifications keep customers informed.
- Tournaments, coaching, and memberships are bookable features.

---

## 3. V1 Decisions That Protect Future Flexibility

### 3.1 Venue-Aware Database Schema

Every table that belongs to a venue has a `venue_id` foreign key from day one.

```sql
-- These tables all have venue_id:
venues          -- 1 row in V1; N rows in future
courts          -- court.venue_id
operating_hours -- oh.venue_id
blocked_dates   -- bd.venue_id
bookings        -- b.venue_id
cms_site_settings -- css.venue_id
```

**Future impact:** Adding a second venue is an INSERT to the `venues` table. All queries that currently filter `WHERE venue_id = $VENUE_ID` will work correctly for multiple venues without schema changes.

**What V1 avoids:** Hardcoding venue identity anywhere in the application or schema. The `VENUE_ID` is an environment variable — never a constant in the code.

### 3.2 Module Boundaries

The `bookings` module contains the core booking logic. It has no knowledge of whether the venue is The Field, Club Cairo, or any other future venue. It operates on `venueId`, `courtId`, and time ranges.

**Future impact:** Extracting the booking module into a shared microservice (if scale requires it) requires no domain logic changes — only transport layer changes.

### 3.3 Storage Abstraction

The `StorageService` interface means the storage backend can change (local disk → S3 → multi-region S3) without changing any calling code.

**Future impact:** If the platform expands to a separate storage bucket per venue (for data isolation), the abstraction layer accommodates this.

### 3.4 Role-Based Access Control

The RBAC model is generic (roles → permissions). The roles `super_admin`, `admin`, `viewer` are V1 instances of the model.

**Future roles to add without restructuring:**
- `venue_owner` — can manage their venue's courts, pricing, schedule, and see their bookings.
- `venue_admin` — like current `admin` but scoped to one venue.
- `platform_admin` — like current `super_admin` but with cross-venue visibility.

The database schema already supports this — just new rows in `admin_roles` and `admin_role_permissions` plus a `venue_id` scope on the admin user.

### 3.5 API Versioning

All routes are at `/api/v1/`. The system can introduce `/api/v2/` with new resource shapes (e.g., adding `venueSlug` to booking responses) without removing V1 endpoints.

### 3.6 Notification Abstraction

The `notifications` module in V1 is a no-op implementation of the `NotificationService` interface. The interface defines:

```typescript
interface NotificationService {
  send(event: NotificationEvent): Promise<void>
}
```

Future implementations (WhatsApp Business API, SMS via Twilio/Vonage) implement this interface and are injected without changing the booking service.

---

## 4. Evolution Path: V1 → Multi-Venue Platform

### Phase 1: Extend Customer Accounts (V1.5)

**Prerequisites:** V1 running stably.

**Changes required:**
- Extend the existing `customer_accounts` model with future account capabilities as needed.
- Add optional account-recovery and notification preferences.
- Extend the authenticated customer booking-history experience.
- Continue using the separate customer session namespace from admin sessions.

**Schema impact:** Additive only. Existing account-owned bookings remain intact.

### Phase 2: Automated Notifications (V1.5 or V2)

**Prerequisites:** Stable booking flow, customer contact info reliable.

**Changes required:**
- Implement `WhatsAppNotificationService` using WhatsApp Business API.
- Inject into booking service: notify on `booking_created`, `booking_approved`, `booking_rejected`.
- Store notification log in a new `notification_events` table.
- Admin setting to enable/disable notifications.

**Schema impact:** New `notification_events` table. No changes to booking tables.

### Phase 3: Online Payment Gateway (V2)

**Prerequisites:** V1.5 stable, payment gateway provider selected (Paymob, Fawry, Stripe).

**Changes required:**
- Add payment method `online` alongside `instapay`.
- Add `payment_gateway_transactions` table: `{ id, payment_id, gateway, transaction_id, status, raw_response }`.
- Implement `PaymentGateway` service interface with gateway-specific adapters.
- Booking status flow changes: instant `approved` after successful online payment (no manual review step).
- Manual InstaPay flow remains available in parallel.

**Schema impact:** New table, new enum value. Existing records unaffected.

### Phase 4: Multi-Venue (V3)

**Prerequisites:** V2 stable, second venue confirmed.

**Changes required:**

**Backend:**
- Admin auth gains `venue_id` scope: venue admins can only see their venue's data.
- Add `venue_owner` account type with access to their venue's dashboard.
- All service functions already accept `venueId` — scope enforcement is configuration not logic.
- Platform admin role gets cross-venue queries.

**Frontend:**
- Customer website becomes a routing layer: `thefield.eg/venues/the-field/` and `thefield.eg/venues/club-cairo/`.
- Alternatively: each venue gets its own subdomain (`thefield.eg`, `clubcairo.eg`) and a shared white-label template.
- Booking flow is identical for every venue — only branding and CMS content change.

**Database changes:**
- `admin_users` gains optional `venue_id` scope column (NULL = platform admin, UUID = venue-scoped).
- All existing data already has `venue_id` populated — migration is clean.

**Timeline estimate:** 3–4 months of development after V2 is stable, assuming the V1/V2 architecture is maintained cleanly.

---

## 5. Scaling the Infrastructure

### Current (V1): Single VPS

Sufficient for: 1 venue, ~50 bookings/day, 100 concurrent users.

### Near future: Vertical Scaling

If bookings grow to ~200/day, upgrade the VPS (more CPU/RAM). Application code requires no changes — stateless Next.js app with database on the same VPS.

### Medium term: Separate Database Server

When database queries become the bottleneck:
- Move PostgreSQL to a dedicated Hostinger managed database or separate VPS.
- Update `DATABASE_URL` — no code changes.
- Enable connection pooling (PgBouncer) between app and DB.

### Multi-venue scale: Horizontal Application Scaling

When traffic grows beyond a single VPS:
- Add a load balancer (Hostinger or Cloudflare).
- Run 2–3 Node.js instances.
- **Note:** The `node-cron` job must be disabled on worker instances (only one instance runs cron). Replace with a dedicated job runner (BullMQ + Redis) or a separate cron VPS.
- Session storage is already cookie-based (stateless) — no session store needed.

### High scale: Microservice Extraction

If the booking engine needs independent scaling:
- The `bookings` module's service layer is already isolated from HTTP transport.
- Extract to a standalone Express or Fastify service behind the main Next.js app.
- Next.js app calls the booking service via internal HTTP or gRPC.

---

## 6. Technical Debt to Address Before Multi-Venue

| Debt Item | V1 Shortcut | Required for Multi-Venue |
|-----------|-------------|--------------------------|
| `VENUE_ID` is a single env var | Fine for 1 venue | Needs to come from request routing (subdomain/slug) |
| CMS settings are venue-scoped but UI has no venue selector | Fine for 1 admin | Needs venue selector in multi-venue admin UI |
| node-cron runs in app process | Fine for 1 process | Must move to dedicated job system before clustering |
| Admin roles are global | Fine for 1 venue | Needs venue-scoped role assignments |
| Booking reference prefix "TF-" is hardcoded | Fine for V1 | Must come from venue config |

None of these are blockers for V1. They are documented here so they are not forgotten.

---

## 7. What V1 Must NOT Do

The following shortcuts would create genuine migration debt that is expensive to fix:

| Do NOT | Reason |
|--------|--------|
| Hardcode venue name "The Field" in database queries | All venue-specific data must be in the `venues` table or CMS settings |
| Omit `venue_id` from any venue-scoped table | Retrofitting FK columns onto tables with data is risky |
| Store state in the Node.js process (in-memory caches, counters) | Cannot scale to multiple processes |
| Build admin UI that assumes only one venue exists in navigation logic | The admin route structure must support a venue context |
| Hardcode "instapay" as the only payment method in booking logic | Payment method must be a variable in the booking and payment models |
