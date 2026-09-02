import { storageConfig } from '@/lib/config'
import { LocalDiskStorageService } from './storage.local'
import { S3StorageService } from './storage.s3'
import type { StorageService } from './storage.types'

/**
 * Storage backend selection (Doc 22 §9.3, M2-T01; Doc 24 §H.1).
 *
 * `STORAGE_PROVIDER` decides which implementation is active. Switching between
 * them requires no code change anywhere else — that is the whole point of the
 * interface, and it is what makes "R2 in production, disk in development" a
 * configuration statement rather than a branch in every caller.
 *
 * Resolution is lazy and memoised. Reading the provider at module load would
 * require a valid environment merely to import a route file, which would break
 * the no-secrets-needed production build.
 */
let cached: StorageService | undefined

export function getStorageService(): StorageService {
  cached ??=
    storageConfig.provider === 'local' ? new LocalDiskStorageService() : new S3StorageService()
  return cached
}

/** Test helper — forces the next `getStorageService()` to re-read the provider. */
export function resetStorageService(): void {
  cached = undefined
}

/**
 * Public URL for a stored key, or null when storage is unconfigured.
 *
 * The single helper every render path uses for court photos, gallery items and
 * CMS images. Returning null instead of throwing is deliberate: a public page
 * must render with a missing image, never fail (Doc 22 §10.5).
 */
export function publicUrlFor(storageKey: string | null | undefined): string | null {
  if (!storageKey) return null
  try {
    return getStorageService().getPublicUrl(storageKey)
  } catch {
    return null
  }
}

export type { StorageService, StorageBucket, PutOptions } from './storage.types'
export { StorageNotConfiguredError } from './storage.types'
