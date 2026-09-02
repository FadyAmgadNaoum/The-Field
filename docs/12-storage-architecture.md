# Storage Architecture
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. Storage Categories

The application manages two distinct categories of files with different security profiles:

| Category | Examples | Access Model | Sensitivity |
|----------|---------|--------------|-------------|
| **Private files** | Payment proof screenshots | Admin-only, signed URL | High — financial documents |
| **Public media** | Gallery images, court photos, hero images | Public read, CDN-cacheable | Low |

These two categories must use different storage paths and access controls. They must never be mixed.

---

## 2. Storage Provider Strategy

### 2.1 Primary Recommendation: S3-Compatible Object Storage

The preferred storage backend is an S3-compatible object storage service:

**Option A (Recommended): Cloudflare R2**
- Zero egress fees (significant saving vs AWS S3).
- S3-compatible API — the same `@aws-sdk/client-s3` client works without code changes.
- Free tier generous for V1 volumes.
- Data stored in Cloudflare's global network.

**Option B: AWS S3**
- Industry standard. Mature SDK. Well-documented.
- Egress fees apply but manageable at V1 scale.

**Option C: Hostinger Object Storage**
- If Hostinger provides S3-compatible storage on the plan, this is the simplest option (same vendor as VPS).
- Check availability on the purchased plan.

**Option D (Fallback): Local VPS Disk**
- Store files in a directory outside the web root.
- Simpler setup but risks data loss on VPS rebuild.
- Files served via Next.js route handler (never via NGINX static file serving directly).
- Acceptable only if object storage is not available and must be migrated to object storage as soon as possible.

### 2.2 Abstraction Layer

Regardless of backend, the application uses a **storage service abstraction** so that the backend can be swapped without changing calling code:

```typescript
// src/modules/storage/storage.service.ts

export interface StorageService {
  put(key: string, file: Buffer, mimeType: string, options?: PutOptions): Promise<void>
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>
  getPublicUrl(key: string): Promise<string>   // for public files only
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}

// Concrete implementations:
// - S3StorageService (uses @aws-sdk/client-s3)
// - LocalDiskStorageService (development / fallback)
```

The active implementation is selected via the `STORAGE_PROVIDER` environment variable (`s3` | `local`).

---

## 3. File Organization (Key Structure)

```
Storage root
├── proofs/
│   └── {bookingId}/
│       └── {ulid}.{ext}          ← payment proof files (PRIVATE)
│
├── courts/
│   └── {courtId}/
│       └── {ulid}.{ext}          ← court photos (PUBLIC)
│
├── cms/
│   ├── gallery/
│   │   └── {ulid}.{ext}          ← gallery images (PUBLIC)
│   ├── events/
│   │   └── {ulid}.{ext}          ← event cover images (PUBLIC)
│   └── hero/
│       └── {ulid}.{ext}          ← hero/background images (PUBLIC)
│
└── temp/
    └── {ulid}.{ext}              ← temporary upload staging (auto-cleaned after 1 hour)
```

Key generation rules:
- All keys use ULID (Universally Unique Lexicographically Sortable Identifier) for the filename component.
- ULIDs are time-sortable, collision-resistant, and unguessable.
- Original filenames supplied by the client are NEVER used in storage keys.
- File extensions are validated and normalized server-side (e.g., `.jpeg` → `.jpg`).

---

## 4. Private File Access: Payment Proofs

Payment proofs are **never** served as publicly accessible files.

### 4.1 Access Flow

```
Admin clicks "View Payment Proof"
        │
        ▼
GET /api/v1/admin/bookings/{bookingId}/proofs/{proofId}/view
        │
        ├── 1. Verify admin session
        ├── 2. Verify admin has 'view_payment_proof' permission
        ├── 3. Load proof record, verify it belongs to a booking
        │      in the venue (IDOR check)
        ├── 4. Log access: audit_logs(action: 'payment_proof_viewed', proofId, adminId)
        ├── 5. Generate signed URL:
        │      storageService.getSignedUrl(proof.storageKey, 300)  ← 5 min expiry
        └── 6. HTTP 302 redirect to signed URL
```

### 4.2 S3 Signed URL Generation

```typescript
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

async function getProofSignedUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: process.env.S3_PRIVATE_BUCKET,
    Key: key,
  })
  return getSignedUrl(s3Client, command, { expiresIn: 300 })
}
```

The signed URL is:
- Valid for 5 minutes only.
- Tied to the specific object key.
- Cannot be used to access any other object.
- Expires and cannot be reused.

### 4.3 Bucket Access Policy

The private bucket must have **no public access** at the bucket policy level:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::thefield-private/*",
      "Condition": {
        "StringNotEquals": {
          "s3:signatureAge": "300"
        }
      }
    }
  ]
}
```

For Cloudflare R2: the bucket is set to "private" with no public access. Signed URLs are generated by the same SDK.

---

## 5. Public File Access: Gallery, Court Photos, CMS Images

Public media files are served with a CDN-friendly public URL. No authentication required.

### 5.1 URL Structure

```
Public CDN URL: https://media.thefield.eg/{key}
  or           : https://{r2-public-url}/{key}
  or (fallback): https://thefield.eg/media/{key}  (served by Next.js route)
```

### 5.2 Public Bucket Policy

The public bucket allows unauthenticated read access (GetObject) for all objects under public prefixes (`courts/`, `cms/`).

### 5.3 Local Development Fallback

In development, public files are served by a Next.js route handler:

```typescript
// src/app/media/[...key]/route.ts  (development only)
export async function GET(req: Request, { params }: { params: { key: string[] } }) {
  const key = params.key.join('/')
  if (!key.startsWith('courts/') && !key.startsWith('cms/')) {
    return new Response('Not found', { status: 404 })
  }
  const filePath = path.join(process.env.LOCAL_STORAGE_PATH!, key)
  // Serve file with appropriate Content-Type header
}
```

---

## 6. Upload Processing

### 6.1 Payment Proof Upload Pipeline

```
Client sends multipart/form-data
        │
        ▼
Next.js API Route parses the multipart body
(using formidable or Next.js built-in multipart handling)
        │
        ▼
Validation (all server-side):
  ├── File present? (required for proof upload endpoint)
  ├── File size ≤ 10MB (10,485,760 bytes)
  ├── MIME type check (read file magic bytes, not just Content-Type header):
  │     Allowed: image/jpeg, image/png, application/pdf
  │     Method: use 'file-type' npm package to read magic bytes
  ├── Extension validation (must match detected MIME)
  └── No embedded scripts / active content (PDF sanitization optional in V1)
        │
        ▼
Generate safe storage key:
  key = `proofs/${bookingId}/${ulid()}.${normalizedExt}`
        │
        ▼
Upload to storage backend:
  storageService.put(key, fileBuffer, detectedMimeType, {
    metadata: { bookingId, uploadedByIp: req.ip }
  })
        │
        ▼
Insert payment_proofs record:
  { paymentId, storageKey: key, originalFilename, fileSizeBytes, mimeType }
        │
        ▼
Update payment_records status → 'submitted'
Update bookings status → 'payment_submitted'
```

### 6.2 CMS Image Upload Pipeline

```
Admin uploads image via CMS dashboard
        │
        ▼
Validation:
  ├── Size ≤ 5MB
  ├── MIME: image/jpeg, image/png, image/webp
  └── Magic bytes check
        │
        ▼
Optional: resize/optimize via sharp:
  - Maximum dimension: 2000px
  - Convert to WebP for gallery/hero (reduces storage + bandwidth)
  - Preserve JPEG for court photos if admin preference
        │
        ▼
Generate key: `cms/gallery/{ulid()}.webp`
        │
        ▼
Upload to PUBLIC storage bucket
Insert cms_gallery_items record
```

**Why image optimization in V1?** Mobile users on Egyptian 4G networks are sensitive to bandwidth. Resizing and converting to WebP reduces image size by 30–70% with no visible quality loss at display sizes. The `sharp` library runs server-side during upload and requires no client-side changes.

---

## 7. Security Controls Summary

| Control | Implementation |
|---------|---------------|
| No public access to proofs | Private S3/R2 bucket + no public bucket policy |
| Signed URLs for proof access | 5-minute expiry; logged per access |
| No client-supplied filenames | Server generates all storage keys via ULID |
| MIME type validation | Magic bytes check (not Content-Type header alone) |
| File size limits | 10MB proofs / 5MB CMS images |
| No script execution | Files stored in object storage (not the web server's filesystem); no execution path |
| Upload audit trail | `payment_proofs` table records upload metadata + IP |
| Admin proof access audit | Every view of a proof is logged in `audit_logs` |
| Temp file cleanup | Temp directory purged hourly by a cleanup job |

---

## 8. Environment Variables

```bash
# Storage provider
STORAGE_PROVIDER=s3                   # 's3' or 'local'

# S3 / R2 configuration
S3_REGION=auto                        # 'auto' for R2; region for AWS
S3_ENDPOINT=https://{accountid}.r2.cloudflarestorage.com   # for R2
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PRIVATE_BUCKET=thefield-private
S3_PUBLIC_BUCKET=thefield-public
S3_PUBLIC_BASE_URL=https://media.thefield.eg

# Local fallback (development)
LOCAL_STORAGE_PATH=./storage
LOCAL_STORAGE_PUBLIC_URL=http://localhost:3000/media
```

---

## 9. Disaster Recovery for Storage

| Scenario | Recovery |
|----------|---------|
| Object storage provider outage | Proof upload returns 503; bookings still accepted without proof (customer can re-upload later) |
| Accidental object deletion | R2/S3 versioning enabled on private bucket; objects recoverable for 30 days |
| VPS rebuild (local storage) | **Data loss risk** — this is why local storage is a fallback only; migrate to object storage immediately |
| Corrupted proof file | Admin marks proof as unreadable; customer re-uploads; old proof retained for audit |

---

## 10. Storage Sizing Estimate (V1)

| File Type | Avg Size | Monthly Volume | Monthly Storage |
|-----------|---------|----------------|-----------------|
| Payment proofs | 1.5 MB | ~300 bookings × 1 proof | ~450 MB/month |
| Court photos | 300 KB | ~20 photos (one-time) | ~6 MB |
| Gallery images (WebP) | 200 KB | ~50 images | ~10 MB |
| Event/CMS images | 200 KB | ~10/month | ~2 MB |

**Year 1 estimate:** ~5–6 GB total storage. Well within free tiers of R2 (10 GB free) and AWS S3.
