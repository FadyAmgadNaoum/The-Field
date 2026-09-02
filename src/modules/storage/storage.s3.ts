import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner'
import { storageConfig } from '@/lib/config'
import { assertSafeStorageKey } from './storage.keys'
import {
  StorageNotConfiguredError,
  type PutOptions,
  type StorageBucket,
  type StorageService,
} from './storage.types'

/**
 * Cloudflare R2 / S3-compatible storage (Doc 12 §2.1, Doc 22 §9.3).
 *
 * Two buckets with different access models (Doc 24 §H.2):
 *   - private: payment proofs. No public policy. Signed URLs only.
 *   - public:  court photos, gallery, CMS media. Served from the CDN.
 *
 * The client is built lazily on first use. Constructing it at module load would
 * require credentials to be present for `next build` to import a route file,
 * which would break the property — established in Milestone 0 and asserted by
 * the build — that a production build needs no secrets.
 */
export class S3StorageService implements StorageService {
  private client: S3Client | undefined

  private config(): {
    client: S3Client
    privateBucket: string
    publicBucket: string
    publicBaseUrl: string | undefined
  } {
    const s3 = storageConfig.s3

    const missing = (
      [
        ['S3_ENDPOINT', s3.endpoint],
        ['S3_ACCESS_KEY_ID', s3.accessKeyId],
        ['S3_SECRET_ACCESS_KEY', s3.secretAccessKey],
        ['S3_PRIVATE_BUCKET', s3.privateBucket],
        ['S3_PUBLIC_BUCKET', s3.publicBucket],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name)

    if (missing.length > 0) throw new StorageNotConfiguredError(missing)

    this.client ??= new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      credentials: {
        accessKeyId: s3.accessKeyId as string,
        secretAccessKey: s3.secretAccessKey as string,
      },
      // R2 requires path-style addressing; virtual-host style is not supported
      // on the S3-compatible endpoint.
      forcePathStyle: true,
    })

    return {
      client: this.client,
      privateBucket: s3.privateBucket as string,
      publicBucket: s3.publicBucket as string,
      publicBaseUrl: s3.publicBaseUrl,
    }
  }

  private bucketName(bucket: StorageBucket): string {
    const { privateBucket, publicBucket } = this.config()
    return bucket === 'private' ? privateBucket : publicBucket
  }

  async put(key: string, data: Buffer, mimeType: string, options: PutOptions): Promise<void> {
    assertSafeStorageKey(key)
    const { client } = this.config()

    await client.send(
      new PutObjectCommand({
        Bucket: this.bucketName(options.bucket),
        Key: key,
        Body: data,
        ContentType: mimeType,
        // Public keys embed a ULID, so an object is never replaced in place and
        // can be cached indefinitely. Private objects are never CDN-cached.
        CacheControl:
          options.cacheControl ??
          (options.bucket === 'public'
            ? 'public, max-age=31536000, immutable'
            : 'private, no-store'),
      }),
    )
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    assertSafeStorageKey(key)
    const { client, privateBucket } = this.config()

    return presign(client, new GetObjectCommand({ Bucket: privateBucket, Key: key }), {
      expiresIn: expiresInSeconds,
    })
  }

  /**
   * Public CDN URL.
   *
   * Returns null when no public base URL is configured rather than throwing:
   * this runs during render for every court and gallery image, and an
   * unconfigured deployment must degrade to a hidden image, not a broken page
   * (Doc 22 §10.5).
   */
  getPublicUrl(key: string): string | null {
    const base = storageConfig.s3.publicBaseUrl
    if (!base) return null

    try {
      assertSafeStorageKey(key)
    } catch {
      return null
    }

    return `${base.replace(/\/+$/, '')}/${key}`
  }

  async delete(key: string, bucket: StorageBucket): Promise<void> {
    assertSafeStorageKey(key)
    const { client } = this.config()
    await client.send(new DeleteObjectCommand({ Bucket: this.bucketName(bucket), Key: key }))
  }

  async exists(key: string, bucket: StorageBucket): Promise<boolean> {
    assertSafeStorageKey(key)
    const { client } = this.config()

    try {
      await client.send(new HeadObjectCommand({ Bucket: this.bucketName(bucket), Key: key }))
      return true
    } catch (error) {
      // A 404/NotFound means the object is absent, which is an answer rather
      // than a failure. Anything else is a real storage fault and must
      // propagate so the caller does not treat an outage as "not present"
      // (Doc 24 §G.3 — the proof row must not be written on an ambiguous read).
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode
      const name = (error as { name?: string }).name
      if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return false
      throw error
    }
  }
}
