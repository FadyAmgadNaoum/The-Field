import { createHmac } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { getSessionSecret, storageConfig } from '@/lib/config'
import { assertSafeStorageKey } from './storage.keys'
import type { PutOptions, StorageBucket, StorageService } from './storage.types'

/**
 * Local disk storage — DEVELOPMENT ONLY (Doc 12 §2.1 Option D, Doc 24 §H.1).
 *
 * `STORAGE_PROVIDER=local` is rejected in production by the environment schema,
 * because persistent customer files on the VPS disk are a launch blocker
 * (Doc 23 §1.3, §16.6). This implementation exists so a developer can run the
 * whole application without a Cloudflare account, and so integration tests can
 * exercise the upload pipeline without network access.
 *
 * Private and public objects are kept in separate subtrees so that the
 * public-media route can serve one and never the other — the same separation
 * the two R2 buckets provide in production.
 */
export class LocalDiskStorageService implements StorageService {
  private root(): string {
    return resolve(process.cwd(), storageConfig.local.path)
  }

  /**
   * Resolve a key to an absolute path, refusing anything that escapes the
   * bucket directory.
   *
   * `assertSafeStorageKey` already rejects traversal, but this second check is
   * the one that matters if a future caller ever passes an externally-derived
   * key: it compares the resolved path against the bucket root rather than
   * trusting the pattern match.
   */
  private pathFor(key: string, bucket: StorageBucket): string {
    assertSafeStorageKey(key)

    const bucketRoot = join(this.root(), bucket)
    const target = resolve(bucketRoot, key)

    if (target !== bucketRoot && !target.startsWith(bucketRoot + sep)) {
      throw new Error('Unsafe storage key')
    }
    return target
  }

  async put(key: string, data: Buffer, _mimeType: string, options: PutOptions): Promise<void> {
    const target = this.pathFor(key, options.bucket)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
  }

  /**
   * Signed URL for a private object.
   *
   * Mirrors the production contract — a time-limited, tamper-evident URL — so
   * development exercises the same code path in the caller. The signature is an
   * HMAC over key + expiry using SESSION_SECRET, verified by the media route.
   */
  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    assertSafeStorageKey(key)

    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds
    const signature = signLocalMediaUrl(key, expiresAt)
    const base = storageConfig.local.publicUrl.replace(/\/+$/, '')

    return `${base}/private/${key}?expires=${expiresAt}&signature=${signature}`
  }

  getPublicUrl(key: string): string | null {
    try {
      assertSafeStorageKey(key)
    } catch {
      return null
    }
    return `${storageConfig.local.publicUrl.replace(/\/+$/, '')}/public/${key}`
  }

  async delete(key: string, bucket: StorageBucket): Promise<void> {
    await rm(this.pathFor(key, bucket), { force: true })
  }

  async exists(key: string, bucket: StorageBucket): Promise<boolean> {
    try {
      const info = await stat(this.pathFor(key, bucket))
      return info.isFile()
    } catch {
      return false
    }
  }

  /** Read an object back. Used by the development media route only. */
  async read(key: string, bucket: StorageBucket): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key, bucket))
    } catch {
      return null
    }
  }
}

/** HMAC over the key and expiry. Shared by the signer and the media route. */
export function signLocalMediaUrl(key: string, expiresAt: number): string {
  return createHmac('sha256', getSessionSecret()).update(`${key}:${expiresAt}`).digest('base64url')
}

/** Constant-time-ish verification of a locally signed media URL. */
export function verifyLocalMediaUrl(key: string, expiresAt: number, signature: string): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return false

  const expected = signLocalMediaUrl(key, expiresAt)
  if (expected.length !== signature.length) return false

  let mismatch = 0
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index)
  }
  return mismatch === 0
}
