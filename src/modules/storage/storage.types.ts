/**
 * Storage abstraction (Doc 12 §2.2, Doc 22 §9.3, M2-T01).
 *
 * Every file the application stores — payment proofs, court photos, CMS media —
 * goes through this interface. Nothing outside `src/modules/storage` knows
 * whether the bytes end up in Cloudflare R2 or on a local disk, which is what
 * makes `STORAGE_PROVIDER` a configuration change rather than a code change
 * (Doc 24 §H.1).
 */

/** Which bucket a key lives in. Two buckets, two access models (Doc 24 §H.2). */
export type StorageBucket =
  /** No public policy. Reachable only through a short-lived signed URL. */
  | 'private'
  /** Served directly from the CDN. Court photos, gallery and CMS media. */
  | 'public'

export interface PutOptions {
  bucket: StorageBucket
  /**
   * Cache-Control for the stored object. Public media is immutable — the key
   * contains a ULID, so a changed image is always a new key.
   */
  cacheControl?: string
}

export interface StorageService {
  /** Write an object. Overwrites silently if the key already exists. */
  put(key: string, data: Buffer, mimeType: string, options: PutOptions): Promise<void>

  /**
   * Time-limited URL for a private object.
   *
   * Doc 24 §H.2 fixes the payment-proof expiry at 5 minutes. The caller passes
   * the window explicitly so the policy stays visible at the call site rather
   * than buried in this module.
   */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>

  /**
   * Stable public URL for an object in the public bucket.
   *
   * Synchronous and never throws: it is called during render for every court
   * and gallery image, and a missing configuration must degrade to a hidden
   * image, not a failed page (Doc 22 §10.5).
   */
  getPublicUrl(key: string): string | null

  delete(key: string, bucket: StorageBucket): Promise<void>

  /**
   * Confirm an object is actually present.
   *
   * Required by Doc 21 RC-002 / Doc 24 §G.3: a `payment_proofs` row may only be
   * written after the object is known to exist, so a failed upload can never
   * leave a database row pointing at nothing.
   */
  exists(key: string, bucket: StorageBucket): Promise<boolean>
}

/** Raised when a storage backend is used before it has been configured. */
export class StorageNotConfiguredError extends Error {
  constructor(missing: readonly string[]) {
    super(`Storage is not configured. Missing environment variables: ${missing.join(', ')}.`)
    this.name = 'StorageNotConfiguredError'
  }
}
