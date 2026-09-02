# Functional Requirements
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## Notation

Each requirement is identified as:
- **FR-CUS-NNN** — Customer-facing functional requirement
- **FR-BKG-NNN** — Booking engine requirement
- **FR-PAY-NNN** — Payment requirement
- **FR-ADM-NNN** — Administrator requirement
- **FR-CMS-NNN** — Content management requirement
- **FR-SEC-NNN** — Security functional requirement
- **FR-AUT-NNN** — Authentication/authorization requirement

Priority: **P1** = Must Have, **P2** = Should Have, **P3** = Nice to Have

---

## 1. Customer-Facing Website

### 1.1 General

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CUS-001 | The website and all public informational pages must be accessible without requiring login or account creation. Authentication is mandatory before a customer can submit or create a booking. | P1 |
| FR-CUS-002 | All customer-facing pages must render correctly on mobile screens (320px minimum width). | P1 |
| FR-CUS-003 | The website must load in under 3 seconds on a 4G mobile connection for all primary pages. | P1 |
| FR-CUS-004 | The website must display The Field's name, logo, and branding on all pages. | P1 |
| FR-CUS-005 | The website must display a WhatsApp contact button with a configurable phone number. | P2 |
| FR-CUS-006 | All page titles, meta descriptions, and canonical URLs must be configurable via the admin CMS. | P2 |
| FR-CUS-007 | Customers must authenticate or create an account before submitting a booking request. A customer who is not authenticated must be redirected to the sign-in page when they attempt to proceed past court and slot selection. | P1 |
| FR-CUS-008 | The system must preserve the customer's selected court, date, and time during the authentication flow, then revalidate all booking information — including court availability, operating hours, slot availability, and server-calculated price — server-side immediately before creating the booking record. | P1 |

### 1.2 Home Page

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CUS-010 | The home page must display a hero section with a headline, subtitle, and call-to-action button linking to the booking flow. | P1 |
| FR-CUS-011 | The home page must display a brief "About The Field" section with CMS-managed text. | P1 |
| FR-CUS-012 | The home page must display a courts summary section showing available courts. | P1 |
| FR-CUS-013 | The home page must display current or upcoming announcements and events if any exist. | P2 |
| FR-CUS-014 | The home page must display a photo gallery preview section. | P2 |

### 1.3 About Page

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CUS-020 | The about page must display venue description, facilities, and mission statement managed via CMS. | P1 |
| FR-CUS-021 | The about page must display operating hours sourced from the database. | P1 |
| FR-CUS-022 | The about page must display the venue address and an embedded map. | P2 |

### 1.4 Courts Page

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CUS-030 | The courts page must display all active courts with name, description, features, and photos. | P1 |
| FR-CUS-031 | Each court listing must show the court's pricing clearly. | P1 |
| FR-CUS-032 | Each court listing must include a "Book Now" button that initialises the booking flow with that court pre-selected. | P1 |
| FR-CUS-033 | Disabled or maintenance courts must not appear on the public courts page. | P1 |

### 1.5 Pricing Page

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CUS-040 | The pricing page must display all active pricing tiers from the database. | P1 |
| FR-CUS-041 | Peak and off-peak pricing must be clearly distinguished with applicable days and hours. | P1 |
| FR-CUS-042 | All prices must be displayed in EGP. | P1 |

### 1.6 Gallery Page

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CUS-050 | The gallery page must display images uploaded via the admin CMS. | P2 |
| FR-CUS-051 | Images must be organized by category if categories are defined. | P3 |
| FR-CUS-052 | Clicking an image must open a lightbox view. | P2 |

### 1.7 FAQs Page

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CUS-060 | The FAQ page must display all published FAQ items from the database. | P2 |
| FR-CUS-061 | FAQs must be displayed in accordion format. | P2 |
| FR-CUS-062 | FAQs must respect the display order set by the administrator. | P2 |

### 1.8 Events and Announcements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CUS-070 | The website must display published events with title, date, description, and optional image. | P2 |
| FR-CUS-071 | The website must display published announcements. | P2 |
| FR-CUS-072 | Expired events and announcements must not appear publicly. | P2 |

### 1.9 Contact Page

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CUS-080 | The contact page must display phone number, email, address, and social media links from the CMS. | P2 |
| FR-CUS-081 | The contact page must display a WhatsApp deep link using the configured number. | P2 |

---

## 2. Booking Engine

### 2.1 Booking Flow — Customer Steps

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-BKG-001 | The booking flow must allow a customer to select a court from a list of active courts. | P1 |
| FR-BKG-002 | The booking flow must allow a customer to select a date from a date picker showing only dates within the operating schedule. | P1 |
| FR-BKG-003 | Dates that are fully blocked or outside operating days must be disabled and unselectable. | P1 |
| FR-BKG-004 | After selecting a court and date, the system must display available time slots for that court and date. | P1 |
| FR-BKG-005 | Time slots that are already booked (confirmed or pending) must be displayed as unavailable and unselectable. | P1 |
| FR-BKG-006 | Time slots that fall within a blocked period or maintenance window must be displayed as unavailable. | P1 |
| FR-BKG-007 | Time slots outside operating hours must not be displayed. | P1 |
| FR-BKG-008 | After selecting a time slot, the system must display the calculated price for that slot. | P1 |
| FR-BKG-009 | The price displayed must be fetched from the server — never accepted from the browser. | P1 |
| FR-BKG-010 | The booking form must collect: customer full name and phone number (Egyptian mobile format). | P1 |
| FR-BKG-011 | The booking form must display InstaPay payment instructions including the venue's InstaPay account number. | P1 |
| FR-BKG-012 | The booking form must allow the customer to upload a payment proof image before submission. | P1 |
| FR-BKG-013 | The customer must be able to submit the booking request. | P1 |
| FR-BKG-014 | On submission, the system must create a booking record with status `pending` and a payment record with status `pending`. | P1 |
| FR-BKG-015 | If a payment proof file is provided at submission, the payment record status transitions to `submitted` and booking to `payment_submitted`. | P1 |
| FR-BKG-016 | On successful submission, the customer must receive a unique, unguessable booking reference number. | P1 |
| FR-BKG-017 | The confirmation screen must display: booking reference, court name, date, time, price, and current status. | P1 |
| FR-BKG-018 | The customer must be able to upload payment proof after booking submission (if not done at initial submission). | P1 |

### 2.2 Availability Logic

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-BKG-020 | A time slot is considered unavailable if a booking with status `approved` exists for that court, date, and overlapping time range. | P1 |
| FR-BKG-021 | A time slot is considered tentatively unavailable if a booking with status `pending` or `payment_submitted` or `under_review` exists for that court, date, and overlapping time range. | P1 |
| FR-BKG-022 | A time slot is considered unavailable if it falls within a blocked time period for that court. | P1 |
| FR-BKG-023 | A time slot is considered unavailable if the date is in the venue's blocked dates list. | P1 |
| FR-BKG-024 | A time slot is considered unavailable if it falls within a maintenance period for that court. | P1 |
| FR-BKG-025 | The system must check availability server-side at the moment of booking submission, not only when displaying the calendar. | P1 |
| FR-BKG-026 | Availability displayed to the customer must reflect the current state of the database at the time of the request. | P1 |

### 2.3 Booking Submission Integrity

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-BKG-030 | The server must validate that the selected court exists and is active. | P1 |
| FR-BKG-031 | The server must validate that the selected date is within the venue's operating schedule. | P1 |
| FR-BKG-032 | The server must validate that the selected time slot falls within operating hours. | P1 |
| FR-BKG-033 | The server must validate that no conflicting booking exists using a serialized database transaction. | P1 |
| FR-BKG-034 | The server must calculate the authoritative price from the database and store it on the booking record. | P1 |
| FR-BKG-035 | If two simultaneous booking requests arrive for the same court and slot, only one must succeed; the other must receive an availability error. | P1 |
| FR-BKG-036 | The system must use database-level locking or exclusion constraints to enforce booking integrity under concurrency. | P1 |

### 2.4 Booking Expiry

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-BKG-040 | A booking in `pending` status with no payment proof submitted must expire after a configurable timeout (default: 2 hours). | P1 |
| FR-BKG-041 | An expired booking must transition to status `expired`. | P1 |
| FR-BKG-042 | An expired booking must release its time slot for new bookings. | P1 |
| FR-BKG-043 | Expiry must be enforced by a background job, not only on the next customer request. | P1 |

### 2.5 Booking Status Lookup

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-BKG-050 | An authenticated customer must be able to view the status of bookings that belong to their account, including by selecting a booking reference from their own booking history. | P1 |
| FR-BKG-051 | The lookup must return: booking status, court name, date, time, price, and payment status. | P1 |
| FR-BKG-052 | The lookup must never return another customer's booking information. | P1 |
| FR-BKG-053 | Booking-status endpoints must require a customer session, scope every query to that session's customer account, and be rate-limited. | P1 |

---

## 3. Payment

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-PAY-001 | The system must support InstaPay as the sole payment method in V1. | P1 |
| FR-PAY-002 | The system must display the venue's InstaPay account number to the customer during checkout. This number must be stored in the CMS, not hardcoded. | P1 |
| FR-PAY-003 | The customer must be able to upload a payment proof file (image: JPEG, PNG, or PDF). | P1 |
| FR-PAY-004 | Uploaded files must be validated for type, size (max 10MB), and must be stored with a server-generated safe filename. | P1 |
| FR-PAY-005 | A payment record must be created for every booking. | P1 |
| FR-PAY-006 | Payment records must have their own independent status: `pending`, `submitted`, `verified`, `rejected`. | P1 |
| FR-PAY-007 | Only an administrator with the `verify_payment` permission can mark a payment as `verified`. | P1 |
| FR-PAY-008 | Only an administrator with the `reject_payment` permission can mark a payment as `rejected`. | P1 |
| FR-PAY-009 | The system must never automatically verify a payment. | P1 |
| FR-PAY-010 | The administrator must be able to view the uploaded payment proof image within the dashboard. | P1 |
| FR-PAY-011 | The payment record must store: upload timestamp, file reference, verifying administrator ID, and verification timestamp. | P1 |
| FR-PAY-012 | Rejected payments must record the rejection reason. | P2 |

---

## 4. Administrator Dashboard

### 4.1 Authentication

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ADM-001 | Administrators must log in with email and password. | P1 |
| FR-ADM-002 | Administrator passwords must be hashed using bcrypt (cost factor ≥ 12). | P1 |
| FR-ADM-003 | Failed login attempts must be rate-limited. | P1 |
| FR-ADM-004 | Administrator sessions must expire after a configurable idle timeout (default: 8 hours). | P1 |
| FR-ADM-005 | Administrators must be able to log out, invalidating their session immediately. | P1 |

### 4.2 Dashboard Overview

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ADM-010 | The dashboard must display a summary of today's confirmed bookings. | P1 |
| FR-ADM-011 | The dashboard must display a count of pending booking requests awaiting review. | P1 |
| FR-ADM-012 | The dashboard must display a count of payment proofs awaiting verification. | P1 |
| FR-ADM-013 | The dashboard must display upcoming bookings for the next 7 days. | P2 |

### 4.3 Booking Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ADM-020 | The admin must be able to view all bookings with filters for: status, court, date range, customer name, phone. | P1 |
| FR-ADM-021 | The admin must be able to view full booking details: customer info, court, date/time, price, payment status, file proof. | P1 |
| FR-ADM-022 | The admin must be able to view the uploaded payment proof image. | P1 |
| FR-ADM-023 | The admin must be able to verify a payment (transitions payment to `verified`). | P1 |
| FR-ADM-024 | The admin must be able to reject a payment with a reason. | P1 |
| FR-ADM-025 | The admin must be able to approve a booking (transitions booking to `approved`). | P1 |
| FR-ADM-026 | Approving a booking must re-validate availability server-side at the moment of approval. | P1 |
| FR-ADM-027 | If a conflict is detected at approval time, the approval must fail with a clear error message. | P1 |
| FR-ADM-028 | The admin must be able to reject a booking with a reason. | P1 |
| FR-ADM-029 | The admin must be able to cancel a confirmed booking with a reason. | P1 |
| FR-ADM-030 | All booking status changes must be recorded in the audit log. | P1 |
| FR-ADM-031 | Booking lists must support pagination. | P1 |

### 4.4 Court Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ADM-040 | The admin must be able to add a new court with: name, description, features, photos, and status. | P1 |
| FR-ADM-041 | The admin must be able to edit an existing court's details. | P1 |
| FR-ADM-042 | The admin must be able to enable or disable a court. | P1 |
| FR-ADM-043 | Disabling a court must not affect existing confirmed bookings. | P1 |
| FR-ADM-044 | The admin must be able to upload court photos. | P2 |

### 4.5 Pricing Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ADM-050 | The admin must be able to define pricing rules per court. | P1 |
| FR-ADM-051 | Pricing rules must support: base price, peak price, applicable days of week, and applicable time ranges. | P1 |
| FR-ADM-052 | The admin must be able to create, edit, and delete pricing rules. | P1 |
| FR-ADM-053 | Pricing changes must not retroactively alter the stored price on existing booking records. | P1 |

### 4.6 Schedule Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ADM-060 | The admin must be able to set operating hours per day of week for the venue. | P1 |
| FR-ADM-061 | The admin must be able to block specific dates (e.g., public holidays). | P1 |
| FR-ADM-062 | The admin must be able to block specific time periods on specific dates for a specific court or all courts. | P1 |
| FR-ADM-063 | The admin must be able to create maintenance periods for a court with a start and end datetime. | P1 |
| FR-ADM-064 | Blocked dates and maintenance periods must reflect immediately in the customer booking flow. | P1 |

### 4.7 Customer Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ADM-070 | The admin must be able to search customers by name or phone number. | P2 |
| FR-ADM-071 | The admin must be able to view all bookings associated with a customer. | P2 |

### 4.8 Administrator Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ADM-080 | A super-admin must be able to create additional administrator accounts. | P1 |
| FR-ADM-081 | A super-admin must be able to assign roles to administrators. | P1 |
| FR-ADM-082 | A super-admin must be able to deactivate an administrator account. | P1 |
| FR-ADM-083 | Deactivated administrators must not be able to log in. | P1 |

### 4.9 Audit Logs

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ADM-090 | Every create, update, approve, reject, cancel, and verify action performed by an administrator must be recorded in the audit log. | P1 |
| FR-ADM-091 | The audit log entry must record: administrator ID, action type, affected entity type, affected entity ID, timestamp, and IP address. | P1 |
| FR-ADM-092 | Audit logs must be viewable by super-admins. | P1 |
| FR-ADM-093 | Audit logs must not be editable or deletable by any role. | P1 |

---

## 5. Content Management System

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CMS-001 | All content listed below must be stored in the database and editable via the admin dashboard. | P1 |
| FR-CMS-002 | Homepage hero text (headline, subtitle, CTA label, CTA link) must be CMS-managed. | P1 |
| FR-CMS-003 | The venue name, description, address, phone number, WhatsApp number, and email must be CMS-managed. | P1 |
| FR-CMS-004 | Operating hours must be CMS-manageable. | P1 |
| FR-CMS-005 | The InstaPay account number (displayed to customers) must be CMS-managed. | P1 |
| FR-CMS-006 | FAQs must be CMS-managed (create, edit, reorder, delete, publish/unpublish). | P2 |
| FR-CMS-007 | Gallery images must be uploadable via the admin dashboard with caption and category. | P2 |
| FR-CMS-008 | Events must be CMS-managed with title, date, description, image, and published status. | P2 |
| FR-CMS-009 | Announcements must be CMS-managed with title, body, expiry date, and published status. | P2 |
| FR-CMS-010 | Social media links (Instagram, Facebook, TikTok, etc.) must be CMS-managed. | P2 |
| FR-CMS-011 | Page SEO metadata (title, description, OG tags) must be CMS-manageable per page. | P3 |
| FR-CMS-012 | About page content must be CMS-managed. | P1 |

---

## 6. Security Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-SEC-001 | All HTTP traffic must be redirected to HTTPS. | P1 |
| FR-SEC-002 | Appropriate security headers must be set (CSP, X-Frame-Options, HSTS, X-Content-Type-Options). | P1 |
| FR-SEC-003 | Session cookies must use HttpOnly and Secure flags. | P1 |
| FR-SEC-004 | All database queries must use parameterized statements or ORM-level binding. | P1 |
| FR-SEC-005 | All file uploads must be validated for type (MIME check, not extension alone) and size. | P1 |
| FR-SEC-006 | Uploaded files must be stored outside the web root or in object storage. | P1 |
| FR-SEC-007 | Uploaded file names must be replaced with server-generated random names. | P1 |
| FR-SEC-008 | Payment proof files must only be accessible to authenticated administrators via a signed or access-controlled URL. | P1 |
| FR-SEC-009 | All admin API routes must verify the administrator's session and required permission before processing. | P1 |
| FR-SEC-010 | Rate limiting must be applied to: booking submission, payment proof upload, and booking status lookup. | P1 |
| FR-SEC-011 | Customer-facing forms must include CSRF protection. | P1 |
| FR-SEC-012 | Input must be validated and sanitized server-side before processing or storage. | P1 |
| FR-SEC-013 | Error messages returned to the browser must not expose internal stack traces or database errors. | P1 |
| FR-SEC-014 | Secrets (DB credentials, API keys, session secrets) must be stored in environment variables, never in source code. | P1 |

---

## 7. Notification Requirements (V1 — Manual)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-NOT-001 | The admin dashboard must visually indicate new pending booking requests (count badge or alert). | P1 |
| FR-NOT-002 | The confirmation screen after booking must display the booking reference prominently. | P1 |
| FR-NOT-003 | The system must not send automated SMS or WhatsApp messages in V1. | P1 |
| FR-NOT-004 | Architecture must allow future addition of WhatsApp and SMS notification providers without rewriting the booking engine. | P2 |
