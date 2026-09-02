# Payment Verification Workflow
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. Overview

Version 1 uses a fully manual payment workflow built around InstaPay, Egypt's dominant peer-to-peer payment network. There is no API integration with InstaPay in V1. The payment is verified by a human administrator reviewing a screenshot or photo of the transfer confirmation.

**Core security rule:** The system must never automatically mark a payment as verified based solely on data supplied by the customer. All payment verification requires an authorized administrator.

---

## 2. InstaPay Context

InstaPay (operated by EBC — Egypt's Interbank Payment Network) allows instant mobile transfers between Egyptian bank accounts and wallets. Customers initiate transfers using:

- The venue's registered InstaPay mobile number or account identifier.
- A fixed transfer amount equal to the booking price displayed on screen.

After a successful transfer, the customer receives an in-app confirmation receipt (screenshot) showing:
- Transaction reference number.
- Amount transferred.
- Recipient name/account.
- Date and time.

This screenshot is what customers upload as proof.

---

## 3. Customer Payment Flow

```
Step 1: Booking Summary Screen
─────────────────────────────
Customer sees:
  Court: Court 2
  Date: 05 September 2026
  Time: 20:00 – 21:00
  Price: 400 EGP
  Payment Method: InstaPay

  [Proceed to Payment]

──────────────────────────────────────────────────────────────────────

Step 2: Payment Instructions Screen
────────────────────────────────────
System displays:
  ┌─────────────────────────────────────────────────────────────────┐
  │  HOW TO PAY                                                     │
  │                                                                 │
  │  1. Open your banking app or InstaPay wallet.                  │
  │  2. Transfer exactly 400 EGP to:                               │
  │                                                                 │
  │     InstaPay Number: 01X-XXX-XXXX   (from CMS — not hardcoded)│
  │     Account Name: The Field                                     │
  │                                                                 │
  │  3. Take a screenshot of the payment confirmation.             │
  │  4. Upload it below.                                           │
  │  5. Submit your booking request.                               │
  │                                                                 │
  │  ⚠ Make sure to transfer the EXACT amount (400 EGP).           │
  │    Transfers with a different amount will be rejected.         │
  └─────────────────────────────────────────────────────────────────┘

  [Upload Payment Screenshot]   ← file input (image/PDF, max 10MB)

  Customer name: Ahmed Mohamed   (pre-filled from step 3)
  Phone: 01XXXXXXXXX             (pre-filled)

  [Submit Booking Request]

──────────────────────────────────────────────────────────────────────

Step 3: Confirmation Screen
────────────────────────────
After submission:
  ✓ Booking Request Submitted

  Your Booking Reference: TF-20260905-K7M2
  Court: Court 2
  Date: 05 September 2026
  Time: 20:00 – 21:00
  Price: 400 EGP
  Status: Payment Submitted – Under Review

  We will confirm your booking after verifying your payment.
  You can check your booking status at any time from your
  authenticated customer account.

  [Check Booking Status]   [Save / Share Reference]
```

---

## 4. What Happens After Submission

```
Customer submits booking
        │
        ▼
Server validates:
  • Court exists and is active
  • Date is operational
  • Time slot is available
  • Price is recalculated from DB (browser price ignored)
        │
        ▼
Database transaction:
  • INSERT INTO customers (upsert on phone)
  • INSERT INTO bookings (status: pending, expires_at: NOW() + 2hrs)
  • INSERT INTO payment_records (status: pending)
        │
        ▼
If file was uploaded:
  • Validate file (MIME, size, extension)
  • Generate safe storage key: proofs/{bookingId}/{ulid}.{ext}
  • Store file in protected storage
  • INSERT INTO payment_proofs
  • UPDATE payment_records SET status = 'submitted'
  • UPDATE bookings SET status = 'payment_submitted'
        │
        ▼
Return booking reference to customer
```

---

## 5. Late Proof Upload (After Initial Submission)

A customer may have submitted the booking without attaching a proof (rare, but the form allows submission without the file). They can upload proof later via the booking status page:

```
Customer visits: /booking-status
Signs in to their customer account (if not already signed in)
        │
        ▼
System verifies the session owns the booking (rate-limited)
        │
        ▼
Customer sees booking record:
  Status: Pending – Awaiting Payment Proof
  [Upload Payment Proof]
        │
        ▼
Same upload flow as above.
Booking transitions: pending → payment_submitted
```

---

## 6. Admin Payment Verification Workflow

### 6.1 Admin Inbox View

The admin dashboard "Booking Requests" section shows a queue ordered by submission time. Bookings with status `payment_submitted` and `under_review` appear at the top.

```
┌──────────────────────────────────────────────────────────────────────┐
│ BOOKING REQUESTS                              [Filter ▼] [Search]   │
├──────────────────────────────────────────────────────────────────────┤
│ ⚡ TF-20260905-K7M2  |  Court 2  |  20:00–21:00  |  Ahmed Mohamed   │
│    05 Sep 2026        |  400 EGP  |  Payment Submitted  |  2 min ago │
│    [View Details]                                                    │
├──────────────────────────────────────────────────────────────────────┤
│    TF-20260905-R3P1  |  Court 1  |  18:00–19:00  |  Omar Hassan    │
│    05 Sep 2026        |  350 EGP  |  Under Review  |  15 min ago    │
│    [View Details]                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.2 Booking Detail View

```
┌──────────────────────────────────────────────────────────────────────┐
│  BOOKING #TF-20260905-K7M2                                          │
├──────────────────────────────────────────────────────────────────────┤
│  CUSTOMER                    BOOKING                                │
│  Name: Ahmed Mohamed         Court: Court 2                         │
│  Phone: 01XXXXXXXXX          Date: 05 September 2026                │
│                              Time: 20:00 – 21:00                    │
│  PAYMENT                     Price: 400 EGP                         │
│  Method: InstaPay            Booking Status: Payment Submitted      │
│  Payment Status: Submitted   Submitted: 31 Aug 2026, 14:32          │
├──────────────────────────────────────────────────────────────────────┤
│  PAYMENT PROOF                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  [Payment screenshot thumbnail — click to open full size]     │ │
│  │  Uploaded: 31 Aug 2026, 14:32 | File: proof.jpg | 1.2 MB     │ │
│  └────────────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────┤
│  ACTIONS                                                            │
│  [✓ Verify Payment & Approve Booking]   [✗ Reject]   [⊘ Cancel]  │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.3 Approval Action

**Trigger:** Admin clicks "Verify Payment & Approve Booking".

**Confirmation dialog:**
```
Confirm Booking Approval

You are about to approve:
  TF-20260905-K7M2 — Court 2 — 05 Sep 2026 — 20:00–21:00

This will:
  ✓ Mark the payment as verified
  ✓ Confirm the booking
  ✓ Reserve the court for this time slot

[Confirm Approval]   [Cancel]
```

**Server-side flow on confirmation:**

```
1. Authenticate admin session
2. Verify admin has 'approve_booking' + 'verify_payment' permissions
3. Load booking; assert status is payment_submitted or under_review
4. BEGIN SERIALIZABLE TRANSACTION
   a. SELECT conflicting approved bookings FOR UPDATE
   b. If conflict found → ROLLBACK → return HTTP 409 with conflict details
   c. UPDATE bookings SET status = 'approved', approved_by, approved_at
   d. UPDATE payment_records SET status = 'verified', verified_by, verified_at
   e. UPDATE payment_proofs SET reviewed_by, reviewed_at
   f. INSERT INTO audit_logs (action: 'booking_approved', ...)
   g. INSERT INTO audit_logs (action: 'payment_verified', ...)
5. COMMIT
6. Return success
```

### 6.4 Rejection Action

**Trigger:** Admin clicks "Reject".

**Admin must provide a reason:**
```
Reject Booking

Reason (required):
[ Payment amount does not match (350 EGP received, 400 EGP required) ▾ ]

Or enter custom reason:
[                                                          ]

[Confirm Rejection]   [Cancel]
```

**Predefined rejection reasons:**
- Payment amount does not match
- Payment proof is not legible / too blurry
- Payment proof appears fraudulent
- Duplicate booking request
- Other (please specify)

**Server-side flow:**

```
1. Authenticate + authorize (reject_booking permission)
2. Load booking; assert status is rejectable
3. BEGIN TRANSACTION
   a. UPDATE bookings SET status = 'rejected', rejected_by, rejected_at, rejection_reason
   b. UPDATE payment_records SET status = 'rejected', rejected_by, rejected_at, rejection_reason
   c. INSERT audit_logs (booking_rejected + payment_rejected)
4. COMMIT
5. Slot is immediately released for new bookings
```

---

## 7. Edge Cases and Rules

### 7.1 Customer Uploads Wrong Amount

The system cannot automatically detect the wrong amount — it relies on the admin to visually verify the proof. The admin rejects with reason "Payment amount does not match". The customer sees this reason when they check their booking status and can contact the venue.

### 7.2 Customer Uploads a Fake Screenshot

The admin reviews the screenshot. If it does not match a real InstaPay transfer confirmation format, the admin rejects with reason "Payment proof appears fraudulent." The booking is rejected. No booking slot is lost (it was held as a soft hold during review; upon rejection it is freed).

### 7.3 Customer Uploads Blurry/Unreadable Proof

Admin rejects payment with "Payment proof is not legible." Booking returns to a rejectable state. Customer can re-upload via the status page (this re-opens the review queue). See Section 5 of the Booking State Machine for the re-upload flow.

### 7.4 Admin Tries to Approve but Slot Was Taken

Another booking was approved for the same slot (by another admin) between when this admin opened the detail view and when they clicked Approve. The server detects this conflict during the transaction and returns:

```
HTTP 409 Conflict

"Unable to approve booking TF-20260905-K7M2.
Court 2 on 05 Sep 2026 at 20:00–21:00 has already been 
confirmed for booking TF-20260905-P9Q3.

You may reject this booking instead."
```

The admin sees this message clearly with the conflicting booking reference.

### 7.5 Double Payment Proof Upload

If a customer uploads proof, then uploads again (e.g., re-submits a better image), both proof records are stored in `payment_proofs`. The admin sees all uploaded proofs. Only the most recent matters for review. Prior proofs are retained for audit purposes.

---

## 8. Payment Proof Storage and Access Security

- Proofs are stored at `proofs/{bookingId}/{ulid}.{safe_ext}` in protected object storage or a non-web-accessible directory.
- No public URL is generated for proof files.
- Admin access is via a short-lived signed URL generated at request time:
  ```
  GET /api/v1/admin/bookings/:bookingId/proof/:proofId
  → Server validates admin session and permission
  → Generates signed URL (expiry: 5 minutes)
  → Redirects to signed URL
  ```
- The signed URL expires after 5 minutes and cannot be shared externally.
- All proof access is logged in the audit log.

---

## 9. InstaPay Number Security

The venue's InstaPay number is stored as a CMS setting key `venue.instapay_number`. It is:
- Readable by any customer during checkout (it must be visible for them to send payment).
- Writable only by admins with the `manage_settings` permission.
- Never hardcoded in source code.
- Not the same as a customer's bank account number — it is the venue's own receiving number.

**IMPORTANT:** The system must never ask customers for or store their own InstaPay account/bank details. The system only needs the customer's screenshot of the completed transfer.
