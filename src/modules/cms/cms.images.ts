import sharp from 'sharp'
import { ValidationError } from '@/lib/errors'
import { validateImageFile } from '@/lib/validation/file'
import { getStorageService } from '@/modules/storage/storage.service'
import { cmsGalleryKey } from '@/modules/storage/storage.keys'

/**
 * CMS image upload pipeline (Doc 22 §9.5).
 *
 * Order is security-first, then processing:
 *
 *  1. **Validate by magic bytes.** The declared `Content-Type` and the filename
 *     are attacker-controlled and are both discarded. `validateImageFile`
 *     inspects the actual signature and enforces the 5MB ceiling.
 *  2. **Re-encode with sharp.** This is not only a size optimisation. Decoding
 *     and re-encoding drops every ancillary chunk the original carried —
 *     EXIF (including GPS coordinates from a phone), colour profiles, and any
 *     payload hidden in a comment segment. What reaches storage is pixels.
 *  3. **Server-generated key.** `cms/gallery/{ulid}.webp` (Doc 12 §3). The
 *     uploaded filename never appears in the key, so path traversal and double
 *     extensions have nothing to act on.
 *  4. **Public bucket.** Gallery images are intentionally public; payment
 *     proofs use the private bucket and a separate pipeline (Doc 24 §H.2).
 */

/** Doc 22 §9.5 — longest edge, preserving aspect ratio. */
const MAX_DIMENSION = 2000

export interface StoredImage {
  storageKey: string
  width: number | undefined
  height: number | undefined
  byteLength: number
}

export async function processAndStoreGalleryImage(buffer: Buffer): Promise<StoredImage> {
  // Step 1 — reject anything that is not genuinely a JPEG, PNG or WebP.
  await validateImageFile(buffer)

  let output: Buffer
  let info: sharp.OutputInfo

  try {
    // Step 2 — `withoutEnlargement` so a small image is not upscaled into a
    // larger, blurrier file. `failOn: 'error'` refuses a truncated or malformed
    // image rather than silently producing a partial one.
    const result = await sharp(buffer, { failOn: 'error' })
      .rotate() // apply the EXIF orientation before the metadata is dropped
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true })

    output = result.data
    info = result.info
  } catch {
    // sharp's own error text can name internal paths and codec details; it is
    // logged by the handler, never returned.
    throw new ValidationError('That image could not be processed. Try a different file.')
  }

  // Step 3 + 4 — server-generated key, public bucket.
  const storageKey = cmsGalleryKey('webp')

  await getStorageService().put(storageKey, output, 'image/webp', { bucket: 'public' })

  return {
    storageKey,
    width: info.width,
    height: info.height,
    byteLength: output.byteLength,
  }
}

/**
 * Read an uploaded file out of a multipart form.
 *
 * The size is checked BEFORE the bytes are materialised into a Buffer, so an
 * oversized upload is rejected without being held in memory in full.
 */
export async function readUploadedFile(form: FormData, field: string): Promise<Buffer> {
  const entry = form.get(field)

  if (!(entry instanceof File)) {
    throw new ValidationError('No file was uploaded.')
  }
  if (entry.size === 0) {
    throw new ValidationError('The file is empty.')
  }
  if (entry.size > 5 * 1024 * 1024) {
    throw new ValidationError('File exceeds the 5MB limit.')
  }

  return Buffer.from(await entry.arrayBuffer())
}
