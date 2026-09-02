# Product Requirements Document
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation  
**Author:** Lead Software Architect

---

## 1. Executive Summary

The Field is a Padel tennis venue in Egypt. This document defines the product requirements for Version 1 of its public-facing booking website and internal administration dashboard.

The goal of Version 1 is to replace a manual or WhatsApp-based booking process with a professional, secure, and maintainable web application that allows customers to browse available courts, request bookings, and complete payment using InstaPay — Egypt's dominant mobile payment network. Administrators manage all bookings, payment verification, and website content through a purpose-built dashboard without touching source code.

Version 1 is scoped exclusively to The Field as a single venue. The internal architecture is designed to be venue-aware from day one so that a future migration to a multi-venue platform does not require rewriting the core booking engine.

---

## 2. Business Context

### 2.1 Problem Statement

Padel venues in Egypt currently rely on WhatsApp groups, phone calls, and informal spreadsheets to manage court bookings. This creates:

- Double bookings and scheduling conflicts.
- No formal payment verification process.
- No audit trail for disputes.
- Poor customer experience.
- High administrative overhead.
- No data on customer behavior or revenue.

### 2.2 Business Objectives

| # | Objective |
|---|-----------|
| B1 | Provide customers with a 24/7 self-service booking channel. |
| B2 | Eliminate double bookings through database-enforced availability. |
| B3 | Provide a structured, verifiable payment workflow around InstaPay. |
| B4 | Give administrators full control over courts, pricing, and availability without developer intervention. |
| B5 | Build a system that can be extended into a multi-venue platform without a full rewrite. |
| B6 | Establish an audit trail for all bookings, payments, and administrative actions. |
| B7 | Provide the venue with actionable data through an admin dashboard. |

### 2.3 Success Metrics

| Metric | Target |
|--------|--------|
| Booking completion rate | > 70% of started bookings reach payment submission |
| Double booking incidents | 0 |
| Admin payment review time | < 2 hours average |
| Mobile usability score | Lighthouse mobile score ≥ 85 |
| Page load time (mobile 4G) | < 3 seconds for booking pages |
| Security incidents (critical) | 0 in first 12 months |

---

## 3. Stakeholders

| Role | Responsibility |
|------|----------------|
| Venue Owner | Final sign-off on product, pricing, and policy decisions |
| Venue Administrator | Day-to-day booking management, payment verification, content updates |
| Customer | Books courts, submits payment, checks booking status |
| Developer(s) | Implementation and maintenance |
| Future Platform Operator | Will inherit the codebase if multi-venue expansion proceeds |

---

## 4. Scope

### 4.1 In Scope — Version 1

- Public-facing website for The Field.
- Court browsing, pricing, and availability — accessible to all visitors without authentication.
- Customer authentication (Google Sign-In and email/password) required before booking submission.
- Booking request submission by authenticated customers.
- Manual InstaPay payment proof upload.
- Booking status tracking using a secure booking reference and the customer's authenticated account.
- Administrator authentication.
- Administrator booking management (view, approve, reject, cancel).
- Administrator payment verification.
- Administrator court and pricing management.
- Administrator availability and schedule management (operating hours, blocked dates, maintenance periods).
- CMS for website content (about, FAQs, gallery, events, announcements, contact info, social media).
- Audit logging of all administrator actions.
- Role-based access control for administrators.
- Secure file storage for payment proofs and images.

### 4.2 Out of Scope — Version 1

- Online payment gateway integration (Stripe, Paymob, Fawry).
- InstaPay API integration.
- Automatic payment verification.
- Multi-venue / marketplace features visible to customers.
- Customer booking history view for authenticated customers.
- SMS or WhatsApp automated notifications.
- Loyalty points or promo codes.
- Tournaments or league scheduling.
- Coaching or instructor booking.
- Membership plans.
- Mobile application.
- Third-party calendar integrations.
- Kubernetes, microservices, or distributed infrastructure.

### 4.3 Explicitly Deferred to Future Version

The following are documented here only to ensure the architecture does not block them:

- Multi-venue support.
- Venue owner accounts.
- Online payment gateway.
- Customer accounts with history.
- Automated notifications (WhatsApp Business API, SMS).
- Promo codes and discounts.
- Loyalty programs.

---

## 5. Users and Personas

### 5.1 Customer (Authenticated User)

**Profile:** Egyptian resident, 18–40 years old, smartphone-first. Likely uses WhatsApp and Instagram daily. May book on behalf of a group. Comfortable with InstaPay. Expects fast, simple mobile experience.

**Goals:**
- Quickly see available courts and prices without signing in.
- Sign in (Google or email/password) and book a court in under 3 minutes.
- Pay using InstaPay and upload proof immediately.
- Check booking status from their account or using their booking reference.

**Pain Points:**
- Having to call or message to find availability.
- Uncertainty about whether a booking is confirmed.
- Losing track of booking reference numbers.

### 5.2 Venue Administrator

**Profile:** Venue staff, possibly non-technical. Uses a computer or tablet. Needs to manage bookings throughout the day. May share the dashboard role with a manager.

**Goals:**
- See all pending bookings instantly.
- View and verify payment proofs quickly.
- Approve or reject bookings with one click.
- Block times for maintenance without developer help.
- Update court prices and hours without code changes.

**Pain Points:**
- Manual tracking in WhatsApp or spreadsheets.
- No clear view of today's confirmed bookings.
- Having to contact the developer to change prices or hours.

### 5.3 Venue Owner

**Profile:** Business owner, rarely technical. Reviews revenue and booking data periodically.

**Goals:**
- Trust that the system prevents double bookings.
- Know that payments are verified before bookings are confirmed.
- Have full audit history of all actions.

---

## 6. Product Features

### 6.1 Customer-Facing Website

| Feature | Priority | Notes |
|---------|----------|-------|
| Home page with venue introduction | P1 | CMS-driven content |
| About page | P1 | CMS-driven |
| Courts listing page | P1 | Active courts from database |
| Pricing page | P1 | Prices from database |
| Booking flow | P1 | Core feature |
| Date and time selection | P1 | Real-time availability check |
| Customer information form | P1 | Authenticated account; name + phone collected or confirmed during booking |
| Booking price display | P1 | Server-calculated |
| InstaPay payment instructions | P1 | Venue's InstaPay details |
| Payment proof upload | P1 | Secure file upload |
| Booking reference confirmation screen | P1 | |
| Booking status lookup | P1 | Authenticated customer account; scoped to the customer's own bookings |
| Gallery page | P2 | CMS-driven |
| FAQs page | P2 | CMS-driven |
| Events and announcements | P2 | CMS-driven |
| Contact page | P2 | CMS-driven |
| WhatsApp contact button | P2 | Configurable number |

### 6.2 Admin Dashboard

| Feature | Priority | Notes |
|---------|----------|-------|
| Secure admin login | P1 | |
| Dashboard summary (today's bookings, pending actions) | P1 | |
| Booking requests queue | P1 | |
| View booking details | P1 | |
| View payment proof | P1 | |
| Verify payment | P1 | |
| Approve booking | P1 | |
| Reject booking | P1 | |
| Cancel booking | P1 | |
| Confirmed bookings list | P1 | |
| Search and filter bookings | P1 | |
| Courts management | P1 | Add, edit, disable |
| Pricing management | P1 | Peak/off-peak by day/time |
| Operating hours management | P1 | |
| Blocked dates | P1 | |
| Blocked time periods | P1 | |
| Maintenance periods | P1 | |
| Customer list and search | P2 | |
| CMS — Homepage | P2 | |
| CMS — About | P2 | |
| CMS — FAQs | P2 | |
| CMS — Gallery | P2 | |
| CMS — Events | P2 | |
| CMS — Announcements | P2 | |
| CMS — Contact Info | P2 | |
| CMS — Social Media | P2 | |
| CMS — SEO Settings | P3 | |
| Administrator management | P1 | |
| Role and permission management | P1 | |
| Audit logs | P1 | |
| System settings | P2 | |

---

## 7. Constraints

| # | Constraint |
|---|-----------|
| C1 | Payment must remain manual (InstaPay transfer + proof upload). No payment gateway APIs in V1. |
| C2 | The system must never auto-confirm a payment. A human administrator must verify. |
| C3 | Double bookings for the same court and time must be impossible for confirmed bookings. |
| C4 | Customer authentication is required before booking submission. Public browsing, court viewing, pricing, and slot availability checking are accessible without login. |
| C5 | Hosting environment is Hostinger (VPS or equivalent). No managed Kubernetes. |
| C6 | The budget and team size favor a modular monolith over microservices. |
| C7 | Egyptian market: V1 supports both Arabic and English with RTL layout for Arabic. |
| C8 | Payment proof files must never be publicly accessible via guessable URLs. |

---

## 8. Assumptions

| # | Assumption |
|---|-----------|
| A1 | The venue has one InstaPay account number, published to customers during checkout. |
| A2 | Courts are identified by name (e.g., "Court 1", "Court 2") and each has distinct pricing rules. |
| A3 | Bookings are one-hour slots aligned to the hour (e.g., 18:00–19:00, 19:00–20:00). Sub-hour or custom-duration bookings are a future requirement. |
| A4 | The venue operates on Egyptian Standard Time (UTC+2). |
| A5 | All prices are in Egyptian Pounds (EGP). |
| A6 | The system will have at most 2–3 simultaneous administrator users. |
| A7 | Customer volume in V1 does not require horizontal scaling. Vertical scaling on a single VPS is sufficient. |
| A8 | Automated email or SMS notifications are not required in V1. The administrator communicates with customers manually if needed. |
| A9 | Customers check booking status and upload payment proof only through their authenticated account; every booking is scoped to its owning customer account. |
| A10 | The venue owner will designate at least one technical administrator to perform the initial system setup. |

---

## 9. Open Questions and Ambiguities

| # | Question | Impact | Resolution Needed By |
|---|----------|--------|----------------------|
| Q1 | Can a single customer book multiple back-to-back slots in one session? | Booking flow design | Pre-implementation |
| Q2 | What is the cancellation policy? Can customers cancel their own bookings, and up to what point? | Booking state machine | Pre-implementation |
| Q3 | Are peak and off-peak prices applied per day of week, per time range, or both? | Pricing model design | Pre-implementation |
| Q4 | How long should a pending booking hold its slot before expiring if no payment is submitted? | Availability logic | Pre-implementation |
| Q5 | Should administrators receive an in-app notification or browser notification when a new booking request arrives? | Admin UX | Pre-implementation |
| Q6 | Is there a requirement for the website to support Arabic language in V1? | Frontend i18n | Pre-implementation |
| Q7 | How many courts does The Field currently operate? | Database seeding | Pre-implementation |
| Q8 | What is the venue's exact operating schedule (days and hours)? | Schedule configuration | Pre-implementation |
| Q9 | Are group discounts or recurring bookings required in V1? | Pricing and booking models | Pre-implementation |
| Q10 | Should rejected or cancelled bookings free up their slot immediately for new bookings? | Booking state transitions | Pre-implementation |

**Default answers applied in this specification (subject to change):**

- Q1: Single slot per booking in V1. Multi-slot is deferred.
- Q2: Customers cannot self-cancel in V1. Only administrators cancel.
- Q3: Pricing is per court with optional peak/off-peak rules by day-of-week and time range.
- Q4: Pending booking expires after 2 hours if no payment proof is uploaded.
- Q5: Admin dashboard shows a live pending count. Push notifications are deferred.
- Q6: V1 supports both Arabic and English with full RTL layout for Arabic (OBD-003 resolved).
- Q7: Architecture supports any number; seeding assumes 2–4 courts.
- Q8: Operating hours are CMS-configurable; default assumption is daily 08:00–24:00.
- Q9: No group discounts or recurring bookings in V1.
- Q10: Rejected and cancelled bookings free their slot immediately.

---

## 10. Compliance and Legal Considerations

- The website must include a Privacy Policy page (template provided; legal review recommended).
- Customer phone numbers are personal data under Egyptian data protection norms and must be stored securely.
- Payment proof images may contain personal financial information and must be access-controlled.
- The system must not store raw payment credentials or full bank account numbers.
- Cookie consent banner is required if analytics cookies are used.

---

## 11. Document History

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.0 | 2026-08-31 | Lead Architect | Initial release |
