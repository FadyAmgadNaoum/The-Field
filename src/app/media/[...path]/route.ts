import { NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api/handler'
import { apiError } from '@/lib/api/response'
import { isProduction, storageConfig } from '@/lib/config'
import { assertSafeStorageKey } from '@/modules/storage/storage.keys'
import { LocalDiskStorageService, verifyLocalMediaUrl } from '@/modules/storage/storage.local'
import type { StorageBucket } from '@/modules/storage/storage.types'

/**
 * Development media route (Doc 12 §2.1 Option D).
 *
 * ── THIS ROUTE DOES NOT EXIST IN PRODUCTION ──────────────────────────────────
 * Production serves public media from the Cloudflare R2 public bucket over the
 * CDN, and private objects through short-lived presigned R2 URLs. Persistent
 * customer files on the VPS disk are a launch blocker (Doc 23 §1.3, §16.6), so
 * this handler refuses to serve anything unless `STORAGE_PROVIDER=local` — and
 * the environment schema already rejects that value in production. Two
 * independent checks, because serving a payment proof from the application
 * origin is exactly the failure this architecture is designed to prevent.
 *
 * ── PRIVATE OBJECTS STILL REQUIRE A SIGNATURE ────────────────────────────────
 * `/media/private/...` is only served with a valid, unexpired HMAC, mirroring
 * the presigned-URL contract of the S3 backend. Development therefore exercises
 * the same access shape as production rather than a permissive shortcut that
 * would hide a mistake until deployment.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

function contentTypeFor(key: string): string {
  const extension = key.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPES[extension] ?? 'application/octet-stream'
}

export const GET = withApiHandler<{ path?: string[] }>(async (request, { requestId, params }) => {
  if (isProduction || storageConfig.provider !== 'local') {
    return apiError('NOT_FOUND', 'Not found.', { requestId })
  }

  const segments = params.path ?? []
  const [bucketSegment, ...rest] = segments

  if ((bucketSegment !== 'public' && bucketSegment !== 'private') || rest.length === 0) {
    return apiError('NOT_FOUND', 'Not found.', { requestId })
  }

  const bucket: StorageBucket = bucketSegment
  const key = rest.join('/')

  try {
    assertSafeStorageKey(key)
  } catch {
    return apiError('NOT_FOUND', 'Not found.', { requestId })
  }

  if (bucket === 'private') {
    const url = new URL(request.url)
    const expires = Number(url.searchParams.get('expires'))
    const signature = url.searchParams.get('signature') ?? ''

    if (!verifyLocalMediaUrl(key, expires, signature)) {
      return apiError('NOT_FOUND', 'Not found.', { requestId })
    }
  }

  const body = await new LocalDiskStorageService().read(key, bucket)
  if (!body) return apiError('NOT_FOUND', 'Not found.', { requestId })

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': contentTypeFor(key),
      // `nosniff` matters most here: it stops a browser reinterpreting a stored
      // file as HTML and executing it from our own origin (Doc 13 T-011).
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Cache-Control':
        bucket === 'public' ? 'public, max-age=3600' : 'private, no-store, must-revalidate',
    },
  })
})
