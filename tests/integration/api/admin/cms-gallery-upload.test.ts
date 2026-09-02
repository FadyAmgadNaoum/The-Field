import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => {
  const { getTestCookieJar } = await import('../../helpers/cookie-jar')
  return { cookies: () => getTestCookieJar() }
})

const cacheMock = vi.hoisted(() => ({ revalidateTag: vi.fn() }))
vi.mock('next/cache', () => ({
  revalidateTag: cacheMock.revalidateTag,
  unstable_cache: <T extends (...args: never[]) => unknown>(loader: T) => loader,
}))

import sharp from 'sharp'
import { establishAdminSession } from '@/lib/auth/admin-session'
import { CSRF_COOKIE, CSRF_HEADER } from '@/lib/auth/csrf-constants'
import { getStorageService } from '@/modules/storage/storage.service'
import { primeCsrf, readEnvelope, uniqueIp } from '../../helpers/auth-requests'
import { getTestCookieJar, resetTestCookieJar } from '../../helpers/cookie-jar'
import { cleanupAccounts, createTestAdmin, trackAdmin } from '../../helpers/accounts'
import { cleanupCmsFixtures, requireVenue, trackGalleryId } from '../../helpers/cms-fixtures'

/**
 * Gallery upload pipeline (Doc 22 M2-T09, §9.5; Doc 13 T-010, T-011).
 *
 * ── WHAT THIS SUITE IS FOR ───────────────────────────────────────────────────
 * This is the one route in Milestone 2 that accepts a file. Doc 24 §J.1 lists
 * upload security — "PHP-as-JPEG, SVG, 11 MB" — as a non-negotiable suite; the
 * unit tests cover the validator in isolation, and these drive the whole route
 * so the validator is proven to actually be wired in.
 *
 * Runs against the local-disk storage backend, which is what
 * `STORAGE_PROVIDER=local` selects in development. The bytes really are written
 * and read back.
 */

/**
 * Copy bytes into a plain ArrayBuffer for use as a `BlobPart`.
 *
 * `File` accepts an ArrayBuffer, but Node's Buffer — and any view over one — is
 * typed against the wider `ArrayBufferLike`, which includes SharedArrayBuffer
 * and which a Blob cannot take. Copying is the honest conversion; a cast would
 * only hide the difference.
 */
function toBlobPart(bytes: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

/** A genuine, small JPEG produced by sharp rather than a hand-built header. */
async function jpegPart(width = 64, height = 64): Promise<ArrayBuffer> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 120, b: 60 } },
  })
    .jpeg()
    .toBuffer()

  return toBlobPart(buffer)
}

function uploadRequest(form: FormData): Request {
  const headers = new Headers()
  headers.set('x-real-ip', uniqueIp())

  const token = getTestCookieJar().get(CSRF_COOKIE)?.value
  if (token) headers.set(CSRF_HEADER, token)

  // Content-Type is deliberately NOT set: the runtime derives the multipart
  // boundary from the FormData, exactly as a browser does.
  return new Request('https://thefield.eg/api/v1/admin/cms/gallery', {
    method: 'POST',
    headers,
    body: form,
  })
}

async function upload(form: FormData) {
  const { POST } = await import('@/app/api/v1/admin/cms/gallery/route')
  return POST(uploadRequest(form))
}

beforeEach(async () => {
  resetTestCookieJar()
  await primeCsrf()
  cacheMock.revalidateTag.mockClear()
})

afterAll(async () => {
  await cleanupCmsFixtures()
  await cleanupAccounts()
})

describe('authorisation', () => {
  it('rejects an unauthenticated upload', async () => {
    const form = new FormData()
    form.set('file', new File([await jpegPart()], 'photo.jpg', { type: 'image/jpeg' }))

    expect((await upload(form)).status).toBe(401)
  })

  it('rejects a viewer', async () => {
    const viewer = trackAdmin(await createTestAdmin({ roleName: 'viewer' }))
    await establishAdminSession({ id: viewer.id, roleId: viewer.roleId })

    const form = new FormData()
    form.set('file', new File([await jpegPart()], 'photo.jpg', { type: 'image/jpeg' }))

    expect((await upload(form)).status).toBe(403)
  })

  it('rejects an upload with no CSRF token', async () => {
    // A multipart route cannot rely on the JSON content-type check, so the
    // explicit token is the control here (Doc 24 §E.4).
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await establishAdminSession({ id: admin.id, roleId: admin.roleId })

    const form = new FormData()
    form.set('file', new File([await jpegPart()], 'photo.jpg', { type: 'image/jpeg' }))

    const { POST } = await import('@/app/api/v1/admin/cms/gallery/route')
    const response = await POST(
      new Request('https://thefield.eg/api/v1/admin/cms/gallery', {
        method: 'POST',
        headers: { 'x-real-ip': uniqueIp() },
        body: form,
      }),
    )

    expect(response.status).toBe(403)
  })
})

describe('accepted uploads', () => {
  it('stores a JPEG, re-encodes it to WebP and records the item', async () => {
    await requireVenue()
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await establishAdminSession({ id: admin.id, roleId: admin.roleId })

    const form = new FormData()
    form.set('file', new File([await jpegPart()], 'photo.jpg', { type: 'image/jpeg' }))
    form.set('caption', 'Centre court at dusk')

    const response = await upload(form)
    expect(response.status).toBe(201)

    const body = await readEnvelope<{
      item: { id: string; caption: string | null; imageUrl: string | null }
    }>(response)
    const item = body.data!.item
    trackGalleryId(item.id)

    expect(item.caption).toBe('Centre court at dusk')

    // The bytes really landed in storage, and the stored object is WebP —
    // Doc 22 §9.5 requires the re-encode, which is also what strips EXIF.
    const { db } = await import('@/lib/db/client')
    const { cmsGalleryItems } = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const rows = await db
      .select({ storageKey: cmsGalleryItems.storageKey })
      .from(cmsGalleryItems)
      .where(eq(cmsGalleryItems.id, item.id))

    const storageKey = rows[0]!.storageKey
    expect(storageKey).toMatch(/^cms\/gallery\/[0-9A-Z]{26}\.webp$/)
    expect(await getStorageService().exists(storageKey, 'public')).toBe(true)
  })

  it('never uses the uploaded filename in the storage key', async () => {
    // Doc 22 §9.4: a client filename carries traversal and double extensions.
    await requireVenue()
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await establishAdminSession({ id: admin.id, roleId: admin.roleId })

    const form = new FormData()
    form.set(
      'file',
      new File([await jpegPart()], '../../../etc/passwd.jpg.php', { type: 'image/jpeg' }),
    )

    const response = await upload(form)
    expect(response.status).toBe(201)

    const body = await readEnvelope<{ item: { id: string } }>(response)
    trackGalleryId(body.data!.item.id)

    const { db } = await import('@/lib/db/client')
    const { cmsGalleryItems } = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const rows = await db
      .select({ storageKey: cmsGalleryItems.storageKey })
      .from(cmsGalleryItems)
      .where(eq(cmsGalleryItems.id, body.data!.item.id))

    const storageKey = rows[0]!.storageKey
    expect(storageKey).not.toContain('passwd')
    expect(storageKey).not.toContain('..')
    expect(storageKey).not.toContain('.php')
  })

  it('resizes an oversized image down to the documented maximum', async () => {
    await requireVenue()
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await establishAdminSession({ id: admin.id, roleId: admin.roleId })

    const form = new FormData()
    form.set('file', new File([await jpegPart(3000, 1500)], 'big.jpg', { type: 'image/jpeg' }))

    const response = await upload(form)
    expect(response.status).toBe(201)

    const body = await readEnvelope<{ item: { id: string } }>(response)
    trackGalleryId(body.data!.item.id)

    const { db } = await import('@/lib/db/client')
    const { cmsGalleryItems } = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const rows = await db
      .select({ storageKey: cmsGalleryItems.storageKey })
      .from(cmsGalleryItems)
      .where(eq(cmsGalleryItems.id, body.data!.item.id))

    const { LocalDiskStorageService } = await import('@/modules/storage/storage.local')
    const stored = await new LocalDiskStorageService().read(rows[0]!.storageKey, 'public')
    expect(stored).not.toBeNull()

    const metadata = await sharp(stored as Buffer).metadata()
    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBeLessThanOrEqual(2000)
    expect(metadata.height).toBeLessThanOrEqual(2000)
  })
})

describe('rejected uploads', () => {
  async function attempt(bytes: Buffer, filename: string, type: string) {
    await requireVenue()
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await establishAdminSession({ id: admin.id, roleId: admin.roleId })

    const form = new FormData()
    form.set('file', new File([toBlobPart(bytes)], filename, { type }))
    return upload(form)
  }

  it('rejects a PHP shell named and typed as a JPEG', async () => {
    // Doc 13 T-010 / Doc 24 §J.1. Both the filename and the declared
    // Content-Type say image/jpeg; only the bytes say otherwise.
    const response = await attempt(
      Buffer.from('<?php system($_GET["cmd"]); ?>'),
      'innocent.jpg',
      'image/jpeg',
    )

    expect(response.status).toBe(400)
    const body = await readEnvelope(response)
    expect(body.error?.code).toBe('VALIDATION_ERROR')
  })

  it('rejects an SVG', async () => {
    // Doc 13 T-011: the one image type that can carry script.
    const response = await attempt(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      'logo.svg',
      'image/svg+xml',
    )

    expect(response.status).toBe(400)
  })

  it('rejects a PDF, which is not an image', async () => {
    const response = await attempt(Buffer.from('%PDF-1.7\n'), 'doc.pdf', 'application/pdf')
    expect(response.status).toBe(400)
  })

  it('rejects a file over the 5MB limit', async () => {
    const response = await attempt(Buffer.alloc(6 * 1024 * 1024, 0x41), 'big.jpg', 'image/jpeg')
    expect(response.status).toBe(400)
  })

  it('rejects a request with no file', async () => {
    await requireVenue()
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await establishAdminSession({ id: admin.id, roleId: admin.roleId })

    expect((await upload(new FormData())).status).toBe(400)
  })

  it('leaks no internal detail when a file is rejected', async () => {
    const response = await attempt(Buffer.from('not an image at all'), 'x.jpg', 'image/jpeg')
    const raw = JSON.stringify(await response.json())

    expect(raw).not.toContain('node_modules')
    expect(raw).not.toContain('sharp')
    expect(raw).not.toContain('at ')
  })
})
