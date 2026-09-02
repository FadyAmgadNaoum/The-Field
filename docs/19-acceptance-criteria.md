# Acceptance Criteria
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. Purpose

This document defines the concrete, testable criteria that must be satisfied before V1 is accepted as complete and production-ready. Each criterion maps to a functional or non-functional requirement and can be verified by a tester, developer, or stakeholder without reading source code.

---

## 2. Customer Experience Acceptance Criteria

### AC-CUS-001: Complete Booking Flow (Authenticated)
**Given** a customer has signed in (Google or email/password) and visits the booking page on a mobile device (390px viewport)  
**When** they select a court, choose a date, choose an available time slot, enter their name and phone number, see the server-calculated price, upload a payment proof image, and submit the booking  
**Then** the entire process completes in under 3 minutes  
**And** a booking confirmation screen appears with a booking reference number matching the format `TF-YYYYMMDD-XXXX`

---

### AC-CUS-001a: Authentication Gate
**Given** an unauthenticated visitor who has selected a court, date, and time slot  
**When** they proceed to the booking submission form  
**Then** they are redirected to the sign-in page  
**And** the selected court, date, and time are preserved in the redirect URL  
**And** after successful sign-in or sign-up they are returned to the booking flow  
**And** the server fully revalidates availability and price before creating the booking record

---

### AC-CUS-002: Booking Status Lookup
**Given** a customer has signed in and has a booking belonging to their account  
**When** they visit the booking status page and select that booking  
**Then** they see the current booking status, court name, date, time, price, and payment status  
**And** they do not see any other customer's booking information  
**And** a booking reference that belongs to another account returns "Booking not found"

---

### AC-CUS-003: Unavailable Slots Not Bookable
**Given** Court 1 has an existing confirmed booking from 19:00 to 20:00 on a given date  
**When** a customer selects Court 1 and that date  
**Then** the 19:00–20:00 slot is shown as unavailable  
**And** the customer cannot select or submit a booking for that slot

---

### AC-CUS-004: Blocked Date Not Bookable
**Given** the administrator has blocked September 8, 2026  
**When** a customer opens the date picker on the booking page  
**Then** September 8 is disabled and cannot be selected

---

### AC-CUS-005: Late Payment Proof Upload
**Given** a customer has a booking in `pending` status (no proof submitted)  
**When** they visit the booking status page and upload a payment proof  
**Then** the booking status updates to `payment_submitted`  
**And** the customer sees "Payment Submitted – Under Review"

---

### AC-CUS-006: Website Content is CMS-Driven
**Given** the administrator updates the venue's WhatsApp number in the CMS settings  
**When** a customer visits the website  
**Then** the WhatsApp button and contact page show the updated phone number (not the old one)

---

### AC-CUS-007: Mobile Usability
**Given** the website is opened on a device with 390px screen width  
**When** a customer navigates through the booking flow  
**Then** no content requires horizontal scrolling  
**And** all interactive elements (buttons, inputs, date picker) are usable with touch  
**And** the Lighthouse mobile performance score is ≥ 85

---

### AC-CUS-008: Public Browsing Without Authentication
**Given** an unauthenticated visitor  
**When** they navigate to the home page, courts page, pricing page, availability calendar, gallery, FAQs, or contact page  
**Then** all pages load and display their content without prompting for login  
**And** the visitor can see court availability without being required to sign in

---

### AC-CUS-009: No Anonymous Booking Submission
**Given** an unauthenticated user  
**When** they attempt to call `POST /api/v1/bookings` directly (e.g., via curl or API client) without a customer session cookie  
**Then** the server returns HTTP 401  
**And** no booking record is created in the database

---

### AC-CUS-010: Every Booking Belongs to an Authenticated Account
**Given** a customer is signed in and submits a booking  
**Then** the booking record in the database has a non-null `customer_account_id` matching the authenticated customer's account  
**And** the `customer_account_id` stored on the booking cannot be overridden by any value in the request body

---

## 3. Booking Engine Acceptance Criteria

### AC-BKG-001: Price is Server-Calculated
**Given** a pricing rule sets Court 1 at 400 EGP on Fridays after 18:00  
**When** an attacker submits a booking request for Court 1 on a Friday at 20:00 with `priceAmount: 1` in the request body  
**Then** the booking is created with `price_amount = 400` in the database (not 1)

---

### AC-BKG-002: Concurrent Booking Integrity
**Given** Court 1 has no bookings on September 10, 2026 at 20:00–21:00  
**When** 10 simultaneous booking requests are submitted for the same court, date, and time  
**Then** exactly 1 booking is created successfully  
**And** the other 9 receive HTTP 409 with error code `BOOKING_CONFLICT`  
**And** the database contains only 1 booking for that slot

---

### AC-BKG-003: Booking Expiry
**Given** a booking is created with status `pending` and `expires_at` set to 2 hours from creation  
**When** 2 hours pass without the customer uploading a proof  
**Then** the booking expiry job transitions the booking to `expired`  
**And** the time slot becomes available for new bookings

---

### AC-BKG-004: Pending Booking Holds Slot
**Given** Booking A is in `payment_submitted` status for Court 1, September 10, 20:00–21:00  
**When** Customer B attempts to book the same slot  
**Then** Customer B sees the slot as unavailable  
**And** the booking creation fails with `BOOKING_CONFLICT`

---

### AC-BKG-005: Maintenance Period Blocks Bookings
**Given** a maintenance period is created for Court 2 from September 15 09:00 to September 15 18:00  
**When** a customer selects Court 2 and September 15  
**Then** all slots between 09:00 and 18:00 are shown as unavailable  
**And** slots outside this range (if within operating hours) remain available

---

## 4. Payment Acceptance Criteria

### AC-PAY-001: Payment Verification is Admin-Only
**Given** a booking has status `payment_submitted`  
**When** the customer attempts to call the approve booking API endpoint directly (e.g., via curl) without an admin session  
**Then** the request returns HTTP 401 or 302 redirect to login  
**And** the booking status does not change

---

### AC-PAY-002: File Type Validation
**Given** the proof upload endpoint  
**When** a customer uploads a file named `proof.php` with PHP content  
**Then** the upload is rejected with an appropriate error message  
**And** no file is stored on the server

---

### AC-PAY-003: File Size Validation
**Given** the proof upload endpoint  
**When** a customer uploads a valid JPEG file that is 11MB in size  
**Then** the upload is rejected with "File size exceeds the maximum limit"  
**And** no file is stored on the server

---

### AC-PAY-004: Payment Proof Access Control
**Given** a payment proof file is stored in private object storage  
**When** an unauthenticated user attempts to access the proof file URL directly  
**Then** they receive HTTP 403 or 401  
**And** the proof content is not returned

---

### AC-PAY-005: Admin Views Proof via Signed URL
**Given** an admin is logged in with the `view_payment_proof` permission  
**When** they navigate to a booking and click "View Payment Proof"  
**Then** a signed URL is generated (valid for 5 minutes)  
**And** the proof image is displayed to the admin  
**And** this access is recorded in the audit log

---

## 5. Admin Dashboard Acceptance Criteria

### AC-ADM-001: Admin Login Security
**Given** an attacker attempts to brute-force the admin login  
**When** they submit 6 failed login attempts within 15 minutes from the same IP  
**Then** subsequent attempts from that IP receive HTTP 429 for the remainder of the lockout period  
**And** the locked-out IP cannot log in even with the correct credentials during the lockout

---

### AC-ADM-002: Permission Enforcement
**Given** an admin with the `viewer` role is logged in  
**When** they attempt to approve a booking (either via UI or direct API call)  
**Then** the action fails with HTTP 403  
**And** the booking status does not change  
**And** no audit log entry is created for the failed action

---

### AC-ADM-003: Approval Conflict Detection
**Given** Booking A (Court 1, September 10, 20:00–21:00) is already `approved`  
**And** Booking B (Court 1, September 10, 20:00–21:00) is in `payment_submitted` status  
**When** an admin attempts to approve Booking B  
**Then** the approval fails with a conflict error message  
**And** the error message references Booking A's reference number  
**And** Booking B remains in `payment_submitted` status  
**And** Booking A remains `approved`

---

### AC-ADM-004: Admin Deactivation Takes Immediate Effect
**Given** Admin B is currently logged in with an active session  
**When** Super Admin deactivates Admin B's account  
**Then** Admin B's next API request returns 401/redirect to login  
**And** Admin B cannot log in until reactivated

---

### AC-ADM-005: Audit Log Completeness
**Given** an admin approves a booking  
**Then** an audit log entry is created with: action `booking_approved`, admin ID, booking ID, timestamp, and IP address  
**And** a separate audit log entry is created for `payment_verified`  
**And** these entries cannot be deleted or edited via the admin UI or API

---

### AC-ADM-006: Court Management
**Given** an admin creates a new court named "Court 3" with status Active  
**When** a customer visits the courts page or starts the booking flow  
**Then** "Court 3" appears in the court listing and is selectable in the booking flow

---

### AC-ADM-007: Pricing Change Does Not Affect Existing Bookings
**Given** Court 1 has a pricing rule of 350 EGP and an approved booking exists with stored price 350 EGP  
**When** the admin changes the pricing rule to 450 EGP  
**Then** the existing approved booking still shows 350 EGP in the admin booking detail  
**And** new bookings for Court 1 will show 450 EGP

---

## 6. Security Acceptance Criteria

### AC-SEC-001: SQL Injection Prevention
**Given** the booking submission endpoint  
**When** a customer submits `'; DROP TABLE bookings; --` as their customer name  
**Then** the name is stored as a literal string (escaped/parameterized)  
**And** the bookings table continues to exist and function correctly

---

### AC-SEC-002: XSS Prevention
**Given** a customer submits `<script>alert('xss')</script>` as their name  
**When** an admin views this booking in the admin dashboard  
**Then** the name is rendered as plain text  
**And** no JavaScript alert executes

---

### AC-SEC-003: HTTPS Enforced
**Given** a user attempts to access `http://thefield.eg` (HTTP)  
**Then** they are automatically redirected to `https://thefield.eg`  
**And** the HSTS header is present on the HTTPS response

---

### AC-SEC-004: Security Headers
**Given** the production website  
**When** scanned by securityheaders.com  
**Then** the result is grade B or higher

---

### AC-SEC-005: No Secrets in Repository
**Given** the Git repository is scanned with gitleaks  
**Then** no secrets, API keys, or credentials are found in the commit history

---

## 7. Performance Acceptance Criteria

### AC-PERF-001: Availability Endpoint Speed
**Given** the production database has 1,000 booking records  
**When** the availability endpoint is called for a valid court and date  
**Then** the response is returned in under 500ms (p95)

---

### AC-PERF-002: Page Load Speed
**Given** a user on a simulated 4G connection (10 Mbps)  
**When** they load the booking page  
**Then** the Largest Contentful Paint (LCP) is under 3 seconds

---

## 8. Data Integrity Acceptance Criteria

### AC-DATA-001: No Double Booking at Database Level
**Given** Booking A is approved for Court 1, September 10, 20:00–21:00  
**When** a direct SQL INSERT is attempted for another approved booking at the same court, date, and overlapping time  
**Then** PostgreSQL raises an exclusion constraint violation (error code 23P01)  
**And** the INSERT is rejected

---

### AC-DATA-002: Booking Records Are Never Hard-Deleted
**Given** a booking is rejected by the admin  
**When** querying the database directly for that booking's ID  
**Then** the record still exists with status `rejected`  
**And** all original fields (court, date, time, price, customer) are intact

---

## 9. Launch Readiness Checklist

Before go-live, the following must all be checked:

- [ ] All P1 Acceptance Criteria above pass on the production environment
- [ ] AC-CUS-008: Public pages accessible without login confirmed
- [ ] AC-CUS-009: Unauthenticated booking submission returns 401 confirmed
- [ ] AC-CUS-010: Every booking has a valid customer_account_id confirmed
- [ ] Google Sign-In completes successfully on production
- [ ] OWASP ZAP baseline scan shows no high/critical findings
- [ ] Semgrep scan shows no high findings
- [ ] npm audit shows no critical/high vulnerabilities
- [ ] gitleaks shows no secrets in git history
- [ ] Lighthouse mobile score ≥ 85 on homepage and booking page
- [ ] TLS certificate is valid and auto-renewal is configured
- [ ] Security headers pass securityheaders.com at grade B+
- [ ] UptimeRobot monitor is active and verified (test downtime alert)
- [ ] Sentry is receiving errors from production (test with intentional error)
- [ ] Backup script is running and a test restore has been completed
- [ ] Admin credentials are changed from seed defaults
- [ ] InstaPay number is correctly configured in CMS settings
- [ ] At least one end-to-end manual booking test completed on production
- [ ] Privacy policy page is live
- [ ] `NODE_ENV=production` is set in the environment
- [ ] No `.env` files with real secrets exist in the repository
