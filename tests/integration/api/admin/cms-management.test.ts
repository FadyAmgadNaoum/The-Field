import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => {
  const { getTestCookieJar } = await import('../../helpers/cookie-jar')
  return { cookies: () => getTestCookieJar() }
})

// `revalidateTag` requires a Next.js request scope, which route handlers driven
// directly in a test do not have. It is stubbed so the cache-invalidation call
// is observable without pulling in the whole rendering runtime; the assertion
// below checks it was CALLED, which is the contract Doc 09 §8 specifies.
const revalidateTag = vi.fn()
vi.mock('next/cache', () => ({
  revalidateTag,
  unstable_cache: <T extends (...args: never[]) => unknown>(loader: T) => loader,
}))

import { establishAdminSession } from '@/lib/auth/admin-session'
import { venueConfig } from '@/lib/config'
import { jsonPost, primeCsrf, readEnvelope, uniqueIp } from '../../helpers/auth-requests'
import { CSRF_COOKIE, CSRF_HEADER } from '@/lib/auth/csrf-constants'
import { getTestCookieJar, resetTestCookieJar } from '../../helpers/cookie-jar'
import {
  cleanupAccounts,
  createTestAdmin,
  trackAdmin,
  type TestAdmin,
} from '../../helpers/accounts'
import {
  cleanupCmsFixtures,
  inspect,
  requireVenue,
  trackAnnouncementId,
  trackFaqId,
  trackSettingKey,
  trackSocialPlatform,
} from '../../helpers/cms-fixtures'

/**
 * Administrator CMS API (Doc 22 M2-T03, §10.3; Doc 09 §6; Doc 24 §E.5).
 *
 * Every route in this suite is gated on `manage_cms`. The `viewer` role does
 * not hold it, which is the whole point of Doc 24 §E.5's read/write split — so
 * a viewer receiving 403 on each of these is the load-bearing assertion, not a
 * formality.
 *
 * The routes are driven directly with real sessions, real CSRF and the real
 * database.
 */

function request(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
  url = 'https://thefield.eg/api/v1/admin/cms',
): Request {
  const headers = new Headers()
  headers.set('x-real-ip', uniqueIp())

  if (method !== 'GET') {
    headers.set('content-type', 'application/json')
    const token = getTestCookieJar().get(CSRF_COOKIE)?.value
    if (token) headers.set(CSRF_HEADER, token)
  }

  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function signIn(admin: TestAdmin): Promise<void> {
  await establishAdminSession({ id: admin.id, roleId: admin.roleId })
}

beforeEach(async () => {
  resetTestCookieJar()
  await primeCsrf()
  revalidateTag.mockClear()
})

afterAll(async () => {
  await cleanupCmsFixtures()
  await cleanupAccounts()
})

describe('authorisation', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const { GET } = await import('@/app/api/v1/admin/cms/settings/route')
    const response = await GET(
      request('GET', undefined, 'https://thefield.eg/api/v1/admin/cms/settings?group=general'),
    )

    expect(response.status).toBe(401)
  })

  it('rejects a viewer with 403 on settings read', async () => {
    // Doc 24 §E.5: `viewer` holds the four read permissions and not
    // `manage_cms`. CMS content is a write surface even on GET here, because
    // the editor exposes unpublished drafts.
    const viewer = trackAdmin(await createTestAdmin({ roleName: 'viewer' }))
    await signIn(viewer)

    const { GET } = await import('@/app/api/v1/admin/cms/settings/route')
    const response = await GET(
      request('GET', undefined, 'https://thefield.eg/api/v1/admin/cms/settings?group=general'),
    )

    expect(response.status).toBe(403)
    const body = await readEnvelope(response)
    expect(body.error?.code).toBe('FORBIDDEN')
  })

  it('rejects a viewer with 403 on every CMS write route', async () => {
    const viewer = trackAdmin(await createTestAdmin({ roleName: 'viewer' }))
    await signIn(viewer)

    const attempts: { name: string; run: () => Promise<Response> }[] = [
      {
        name: 'settings',
        run: async () =>
          (await import('@/app/api/v1/admin/cms/settings/route')).PUT(
            request('PUT', { group: 'general', settings: {} }),
          ),
      },
      {
        name: 'faqs',
        run: async () =>
          (await import('@/app/api/v1/admin/cms/faqs/route')).POST(
            request('POST', { question: 'A question?', answer: 'An answer that is long enough.' }),
          ),
      },
      {
        name: 'announcements',
        run: async () =>
          (await import('@/app/api/v1/admin/cms/announcements/route')).POST(
            request('POST', { title: 'Title', body: 'Body' }),
          ),
      },
      {
        name: 'events',
        run: async () =>
          (await import('@/app/api/v1/admin/cms/events/route')).POST(
            request('POST', { title: 'An event' }),
          ),
      },
      {
        name: 'social',
        run: async () =>
          (await import('@/app/api/v1/admin/cms/social/route')).PUT(
            request('PUT', { platform: 'instagram', url: 'https://example.test' }),
          ),
      },
    ]

    for (const attempt of attempts) {
      const response = await attempt.run()
      expect(response.status, `${attempt.name} should be forbidden for viewer`).toBe(403)
    }
  })

  it('rejects a write with no CSRF token', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const headers = new Headers({ 'content-type': 'application/json', 'x-real-ip': uniqueIp() })
    const { PUT } = await import('@/app/api/v1/admin/cms/settings/route')
    const response = await PUT(
      new Request('https://thefield.eg/api/v1/admin/cms/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ group: 'general', settings: {} }),
      }),
    )

    expect(response.status).toBe(403)
  })

  it('rejects a write without the JSON content type', async () => {
    // Doc 24 §E.4 — the secondary CSRF control. A cross-origin HTML form cannot
    // set this header.
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const { PUT } = await import('@/app/api/v1/admin/cms/settings/route')
    const response = await PUT(
      jsonPost({ group: 'general', settings: {} }, { contentType: 'text/plain' }),
    )

    expect(response.status).toBe(400)
  })
})

describe('settings', () => {
  it('returns the catalogue alongside stored values', async () => {
    await requireVenue()
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const { GET } = await import('@/app/api/v1/admin/cms/settings/route')
    const response = await GET(
      request('GET', undefined, 'https://thefield.eg/api/v1/admin/cms/settings?group=payment'),
    )

    expect(response.status).toBe(200)
    const body = await readEnvelope<{
      group: string
      definitions: { key: string }[]
      values: Record<string, string | null>
    }>(response)

    expect(body.data?.group).toBe('payment')
    // The editor renders every field, including ones never yet saved.
    expect(body.data?.definitions.map((d) => d.key)).toContain('venue.instapay_number')
  })

  it('rejects an unknown group', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const { GET } = await import('@/app/api/v1/admin/cms/settings/route')
    const response = await GET(
      request('GET', undefined, 'https://thefield.eg/api/v1/admin/cms/settings?group=nope'),
    )

    expect(response.status).toBe(400)
  })

  it('saves a value and reflects it on the next read', async () => {
    // M2-T08's acceptance criterion: an admin updates the venue name and sees
    // the change on the public homepage.
    await requireVenue()
    trackSettingKey('venue.name')
    trackSettingKey('venue.tagline')

    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const { PUT } = await import('@/app/api/v1/admin/cms/settings/route')
    const response = await PUT(
      request('PUT', {
        group: 'general',
        settings: { 'venue.name': 'The Field Testing', 'venue.tagline': 'A tagline' },
      }),
    )

    expect(response.status).toBe(200)
    expect(await inspect.settingValue('venue.name')).toBe('The Field Testing')
    expect(await inspect.settingValue('venue.tagline')).toBe('A tagline')
  })

  it('invalidates the public cache tag on save', async () => {
    // Doc 09 §8 — without this the public site keeps serving the old value.
    await requireVenue()
    trackSettingKey('venue.name')

    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const { PUT } = await import('@/app/api/v1/admin/cms/settings/route')
    await PUT(request('PUT', { group: 'general', settings: { 'venue.name': 'Cache Test' } }))

    expect(revalidateTag).toHaveBeenCalledWith(`cms-${venueConfig.id}`)
  })

  it('rejects a malformed InstaPay number without writing anything', async () => {
    // The value a customer transfers money to. A bad one must never be stored.
    await requireVenue()
    trackSettingKey('venue.instapay_number')
    trackSettingKey('venue.instapay_account_name')

    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const { PUT } = await import('@/app/api/v1/admin/cms/settings/route')
    const response = await PUT(
      request('PUT', {
        group: 'payment',
        settings: {
          'venue.instapay_number': 'not-a-number',
          'venue.instapay_account_name': 'Should Not Be Saved',
        },
      }),
    )

    expect(response.status).toBe(400)
    // The whole group is rejected, so the valid sibling field is not written
    // either — the administrator never has to work out which half applied.
    expect(await inspect.settingValue('venue.instapay_number')).toBeNull()
    expect(await inspect.settingValue('venue.instapay_account_name')).toBeNull()
  })

  it('returns field-level errors for the editor to display', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const { PUT } = await import('@/app/api/v1/admin/cms/settings/route')
    const response = await PUT(
      request('PUT', {
        group: 'contact',
        settings: { 'venue.email': 'not-an-email' },
      }),
    )

    const body = await readEnvelope<unknown>(response)
    const details = body.error?.details as { fieldErrors?: Record<string, string[]> } | undefined
    expect(details?.fieldErrors?.['venue.email']?.[0]).toBeTruthy()
  })

  it('rejects a key that is not in the group', async () => {
    // The settings table is a fixed schema, not a free-form key-value store.
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const { PUT } = await import('@/app/api/v1/admin/cms/settings/route')
    const response = await PUT(
      request('PUT', { group: 'general', settings: { 'venue.instapay_number': '01012345678' } }),
    )

    expect(response.status).toBe(400)
    expect(await inspect.settingValue('venue.instapay_number')).toBeNull()
  })

  it('sanitises rich text at write time', async () => {
    // Doc 22 §10.6: the STORED value is already safe, so no future reader has
    // to remember to clean it.
    await requireVenue()
    trackSettingKey('about.body')

    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const { PUT } = await import('@/app/api/v1/admin/cms/settings/route')
    await PUT(
      request('PUT', {
        group: 'about',
        settings: { 'about.body': '<p>Welcome</p><script>alert(1)</script>' },
      }),
    )

    const stored = await inspect.settingValue('about.body')
    expect(stored).toContain('Welcome')
    expect(stored).not.toContain('script')
    expect(stored).not.toContain('alert(1)')
  })

  it('stores an empty value as NULL so consumers see absence', async () => {
    await requireVenue()
    trackSettingKey('venue.tagline')

    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const { PUT } = await import('@/app/api/v1/admin/cms/settings/route')
    await PUT(request('PUT', { group: 'general', settings: { 'venue.tagline': 'Something' } }))
    expect(await inspect.settingValue('venue.tagline')).toBe('Something')

    await PUT(request('PUT', { group: 'general', settings: { 'venue.tagline': '' } }))
    expect(await inspect.settingValue('venue.tagline')).toBeNull()
  })

  it('writes an audit row for every changed key', async () => {
    // Doc 09 §6.1 and Doc 22 §10.3.
    await requireVenue()
    trackSettingKey('venue.name')

    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const { PUT } = await import('@/app/api/v1/admin/cms/settings/route')
    await PUT(request('PUT', { group: 'general', settings: { 'venue.name': 'Audited Name' } }))

    const { db } = await import('@/lib/db/client')
    const { auditLogs } = await import('@/db/schema')
    const { and, eq } = await import('drizzle-orm')

    const rows = await db
      .select({ action: auditLogs.action, newValue: auditLogs.newValue })
      .from(auditLogs)
      .where(and(eq(auditLogs.adminId, admin.id), eq(auditLogs.action, 'cms_updated')))

    expect(rows.length).toBeGreaterThan(0)
  })

  it('redacts the InstaPay number in the audit trail', async () => {
    // The change must be recorded — an unexplained edit to a payment
    // destination is exactly what an audit log exists to catch — but the full
    // value does not need to sit in a jsonb column many roles can read.
    await requireVenue()
    trackSettingKey('venue.instapay_number')

    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const { PUT } = await import('@/app/api/v1/admin/cms/settings/route')
    await PUT(
      request('PUT', {
        group: 'payment',
        settings: { 'venue.instapay_number': '01012345678' },
      }),
    )

    const { db } = await import('@/lib/db/client')
    const { auditLogs } = await import('@/db/schema')
    const { and, eq } = await import('drizzle-orm')

    const rows = await db
      .select({ newValue: auditLogs.newValue })
      .from(auditLogs)
      .where(and(eq(auditLogs.adminId, admin.id), eq(auditLogs.action, 'cms_updated')))

    const serialised = JSON.stringify(rows)
    expect(serialised).not.toContain('01012345678')
    expect(serialised).toContain('5678')
  })
})

describe('FAQs', () => {
  it('creates, updates, reorders and soft-deletes', async () => {
    await requireVenue()
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const faqs = await import('@/app/api/v1/admin/cms/faqs/route')
    const faqById = await import('@/app/api/v1/admin/cms/faqs/[id]/route')
    const reorder = await import('@/app/api/v1/admin/cms/faqs/reorder/route')

    const first = await readEnvelope<{ faq: { id: string } }>(
      await faqs.POST(
        request('POST', { question: 'First question?', answer: 'The first answer here.' }),
      ),
    )
    const second = await readEnvelope<{ faq: { id: string } }>(
      await faqs.POST(
        request('POST', { question: 'Second question?', answer: 'The second answer here.' }),
      ),
    )

    const firstId = first.data!.faq.id
    const secondId = second.data!.faq.id
    trackFaqId(firstId)
    trackFaqId(secondId)

    // Update
    await faqById.PUT(
      request('PUT', {
        question: 'First question, revised?',
        answer: 'A revised answer here.',
        isPublished: false,
      }),
      { params: { id: firstId } },
    )
    const updated = await inspect.faqById(firstId)
    expect(updated?.question).toBe('First question, revised?')
    expect(updated?.isPublished).toBe(false)

    // Reorder — the whole ordering is applied in one transaction.
    await reorder.POST(request('POST', { orderedIds: [secondId, firstId] }))
    expect((await inspect.faqById(secondId))?.displayOrder).toBe(0)
    expect((await inspect.faqById(firstId))?.displayOrder).toBe(1)

    // Soft delete — the row survives (Doc 03 NFR-DATA-004).
    await faqById.DELETE(request('DELETE'), { params: { id: firstId } })
    const deleted = await inspect.faqById(firstId)
    expect(deleted).not.toBeNull()
    expect(deleted?.deletedAt).not.toBeNull()
  })

  it('answers 404 for an unknown id rather than confirming the id space', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const faqById = await import('@/app/api/v1/admin/cms/faqs/[id]/route')
    const response = await faqById.DELETE(request('DELETE'), {
      params: { id: '11111111-2222-4333-8444-555555555555' },
    })

    expect(response.status).toBe(404)
  })

  it('answers 404 for a malformed id, not 400', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const faqById = await import('@/app/api/v1/admin/cms/faqs/[id]/route')
    const response = await faqById.DELETE(request('DELETE'), { params: { id: 'not-a-uuid' } })

    expect(response.status).toBe(404)
  })

  it('rejects a question that is too short', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const faqs = await import('@/app/api/v1/admin/cms/faqs/route')
    const response = await faqs.POST(
      request('POST', { question: 'Hi', answer: 'Long enough here.' }),
    )

    expect(response.status).toBe(400)
  })
})

describe('announcements', () => {
  it('creates one and exposes it to the public active list only when published', async () => {
    await requireVenue()
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const route = await import('@/app/api/v1/admin/cms/announcements/route')

    const draft = await readEnvelope<{ announcement: { id: string } }>(
      await route.POST(request('POST', { title: 'Draft notice', body: 'Not published yet.' })),
    )
    const published = await readEnvelope<{ announcement: { id: string } }>(
      await route.POST(
        request('POST', { title: 'Live notice', body: 'Published.', isPublished: true }),
      ),
    )

    trackAnnouncementId(draft.data!.announcement.id)
    trackAnnouncementId(published.data!.announcement.id)

    const cms = await import('@/modules/cms/cms.service')
    const active = await cms.getActiveAnnouncements(venueConfig.id)
    const titles = active.map((item) => item.title)

    expect(titles).toContain('Live notice')
    expect(titles).not.toContain('Draft notice')
  })

  it('rejects an expiry in the past', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const route = await import('@/app/api/v1/admin/cms/announcements/route')
    const response = await route.POST(
      request('POST', {
        title: 'Stale',
        body: 'Body',
        expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    )

    expect(response.status).toBe(400)
  })

  it('retires an announcement off the public list without deleting the row', async () => {
    // The runtime role holds SELECT, INSERT and UPDATE only — no DELETE on any
    // table (src/db/migrations/raw/0004_privileges.sql). A hard delete here
    // would have raised 42501 in production and nowhere else. Retiring gives
    // the same customer-facing outcome within the privileges that exist.
    await requireVenue()
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const route = await import('@/app/api/v1/admin/cms/announcements/route')
    const byId = await import('@/app/api/v1/admin/cms/announcements/[id]/route')
    const cms = await import('@/modules/cms/cms.service')

    const created = await readEnvelope<{ announcement: { id: string } }>(
      await route.POST(request('POST', { title: 'To retire', body: 'Body', isPublished: true })),
    )
    const id = created.data!.announcement.id
    trackAnnouncementId(id)

    expect((await cms.getActiveAnnouncements(venueConfig.id)).map((a) => a.id)).toContain(id)

    const response = await byId.DELETE(request('DELETE'), { params: { id } })
    expect(response.status).toBe(200)

    // Gone from the customer's view…
    expect((await cms.getActiveAnnouncements(venueConfig.id)).map((a) => a.id)).not.toContain(id)
    // …but the record survives.
    const row = await inspect.announcementById(id)
    expect(row).not.toBeNull()
    expect(row?.isPublished).toBe(false)
  })

  it('excludes an expired announcement from the public list', async () => {
    await requireVenue()
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const route = await import('@/app/api/v1/admin/cms/announcements/route')
    const created = await readEnvelope<{ announcement: { id: string } }>(
      await route.POST(
        request('POST', {
          title: 'Expires soon',
          body: 'Body',
          isPublished: true,
          expiresAt: new Date(Date.now() + 2000).toISOString(),
        }),
      ),
    )
    const id = created.data!.announcement.id
    trackAnnouncementId(id)

    // Move the expiry into the past directly, rather than sleeping.
    const { db } = await import('@/lib/db/client')
    const { cmsAnnouncements } = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')
    await db
      .update(cmsAnnouncements)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(cmsAnnouncements.id, id))

    const cms = await import('@/modules/cms/cms.service')
    const active = await cms.getActiveAnnouncements(venueConfig.id)
    expect(active.map((item) => item.id)).not.toContain(id)
  })
})

describe('social links', () => {
  it('upserts a platform and clears it with an empty URL', async () => {
    await requireVenue()
    trackSocialPlatform('instagram')

    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const route = await import('@/app/api/v1/admin/cms/social/route')
    const cms = await import('@/modules/cms/cms.service')

    const created = await route.PUT(
      request('PUT', { platform: 'instagram', url: 'https://example.test/thefield' }),
    )
    expect(created.status).toBe(200)
    expect((await inspect.socialLink('instagram'))?.url).toBe('https://example.test/thefield')

    // A second write updates rather than duplicating — uq_social_platform.
    const updated = await route.PUT(
      request('PUT', { platform: 'instagram', url: 'https://example.test/updated' }),
    )
    expect(updated.status).toBe(200)
    expect((await inspect.socialLink('instagram'))?.url).toBe('https://example.test/updated')

    // An empty URL clears it. The row survives — `app_user` holds no DELETE
    // right on any table — but the link leaves the public footer, which is the
    // property that matters.
    const cleared = await route.PUT(request('PUT', { platform: 'instagram', url: '' }))
    expect(cleared.status).toBe(200)

    const row = await inspect.socialLink('instagram')
    expect(row?.url).toBe('')
    expect(row?.isActive).toBe(false)

    const publicLinks = await cms.getSocialLinks(venueConfig.id, true)
    expect(publicLinks.map((link) => link.platform)).not.toContain('instagram')
  })

  it('rejects a non-HTTPS URL', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const route = await import('@/app/api/v1/admin/cms/social/route')
    const response = await route.PUT(
      request('PUT', { platform: 'facebook', url: 'javascript:alert(1)' }),
    )

    expect(response.status).toBe(400)
  })

  it('rejects an unknown platform', async () => {
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const route = await import('@/app/api/v1/admin/cms/social/route')
    const response = await route.PUT(
      request('PUT', { platform: 'myspace', url: 'https://example.test' }),
    )

    expect(response.status).toBe(400)
  })
})

describe('error responses', () => {
  it('never returns a stack trace or SQL detail', async () => {
    // Doc 02 FR-SEC-013 / Doc 03 NFR-AVAIL-006.
    const admin = trackAdmin(await createTestAdmin({ roleName: 'admin' }))
    await signIn(admin)

    const { PUT } = await import('@/app/api/v1/admin/cms/settings/route')
    const response = await PUT(request('PUT', { group: 'general', settings: { bad: 'x' } }))
    const raw = JSON.stringify(await response.json())

    expect(raw).not.toContain('at ')
    expect(raw).not.toContain('node_modules')
    expect(raw).not.toContain('SELECT')
    expect(raw).not.toContain('INSERT')
    expect(raw).not.toContain('pg')
  })
})
