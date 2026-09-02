import { fileTypeFromBuffer } from 'file-type'
import { ValidationError } from '../errors'

/**
 * Upload validation (Doc 22 §9.4, §9.5; Doc 13 T-010, T-011; Doc 24 §H.2).
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 * The type of an uploaded file is decided by its MAGIC BYTES, never by the
 * `Content-Type` header and never by the filename extension. Both of those are
 * chosen by the client. A PHP web shell renamed `photo.jpg` and sent with
 * `Content-Type: image/jpeg` passes every header-based check and fails this one.
 *
 * SVG is rejected explicitly. It is a document format that can carry script,
 * and it is the one image type that turns an image host into a stored-XSS
 * vector (Doc 13 T-011).
 */

/** Doc 24 §H.2 — payment proofs. */
const PROOF_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const PROOF_MAX_BYTES = 10 * 1024 * 1024

/** Doc 22 §9.5 — CMS and court images. */
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const IMAGE_MAX_BYTES = 5 * 1024 * 1024

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

export interface ValidatedUpload {
  mimeType: string
  extension: string
  byteLength: number
}

async function validate(
  buffer: Buffer,
  allowed: ReadonlySet<string>,
  maxBytes: number,
  humanTypes: string,
): Promise<ValidatedUpload> {
  if (buffer.byteLength === 0) {
    throw new ValidationError('The file is empty.')
  }
  if (buffer.byteLength > maxBytes) {
    throw new ValidationError(`File exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB limit.`)
  }

  const detected = await fileTypeFromBuffer(buffer)

  // `file-type` returns undefined for formats with no signature — plain text,
  // SVG, HTML, and most script files. Treating "unrecognised" as "not allowed"
  // is what closes that hole.
  if (!detected || !allowed.has(detected.mime)) {
    throw new ValidationError(`File type not allowed. Upload ${humanTypes} only.`)
  }

  // Belt and braces. Doc 22 §9.4 asks for an explicit SVG rejection. The
  // comparison is written against the widened string type because `file-type`'s
  // `MimeType` union does not include SVG at all — it has no magic number, so
  // detection returns undefined and the check above already rejects it. Stating
  // it anyway means widening the allow list later cannot silently admit it.
  if ((detected.mime as string) === 'image/svg+xml') {
    throw new ValidationError('SVG files are not accepted.')
  }

  const extension = EXTENSION_BY_MIME[detected.mime]
  if (!extension) {
    throw new ValidationError(`File type not allowed. Upload ${humanTypes} only.`)
  }

  return { mimeType: detected.mime, extension, byteLength: buffer.byteLength }
}

/** Payment proof: JPEG, PNG or PDF, at most 10MB (Doc 24 §H.2). */
export function validateProofFile(buffer: Buffer): Promise<ValidatedUpload> {
  return validate(buffer, PROOF_MIME_TYPES, PROOF_MAX_BYTES, 'JPEG, PNG or PDF')
}

/** CMS or court image: JPEG, PNG or WebP, at most 5MB (Doc 22 §9.5). */
export function validateImageFile(buffer: Buffer): Promise<ValidatedUpload> {
  return validate(buffer, IMAGE_MIME_TYPES, IMAGE_MAX_BYTES, 'JPEG, PNG or WebP')
}

export const UPLOAD_LIMITS = {
  proofMaxBytes: PROOF_MAX_BYTES,
  imageMaxBytes: IMAGE_MAX_BYTES,
  proofMimeTypes: [...PROOF_MIME_TYPES],
  imageMimeTypes: [...IMAGE_MIME_TYPES],
} as const
