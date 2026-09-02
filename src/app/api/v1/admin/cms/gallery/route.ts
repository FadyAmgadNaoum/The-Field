import { withApiHandler } from '@/lib/api/handler'
import { requireAdminFor } from '@/lib/api/admin-guard'
import { apiSuccess } from '@/lib/api/response'
import { venueConfig } from '@/lib/config'
import { ValidationError } from '@/lib/errors'
import * as cms from '@/modules/cms/cms.service'
import { processAndStoreGalleryImage, readUploadedFile } from '@/modules/cms/cms.images'

/**
 * Gallery collection (Doc 22 M2-T03, §9.5; Doc 09 §6.3).
 *
 * ── WHY THIS ROUTE IS MULTIPART ──────────────────────────────────────────────
 * It carries an image. The JSON content-type CSRF check therefore does not
 * apply (a cross-origin HTML form CAN post multipart), so the explicit CSRF
 * token and `SameSite=Lax` are the controls — `requireAdminFor` still checks
 * the token, it only skips the content-type assertion (Doc 24 §E.4).
 *
 * The bytes are validated by magic number and re-encoded before storage; see
 * `cms.images.ts` for what that buys.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withApiHandler(async (request, { requestId }) => {
  await requireAdminFor(request, 'manage_cms')
  const items = await cms.getGalleryItems(venueConfig.id, false)
  return apiSuccess({ items }, { requestId })
})

export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireAdminFor(request, 'manage_cms', { multipart: true })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new ValidationError('The upload could not be read.')
  }

  const buffer = await readUploadedFile(form, 'file')
  const { storageKey } = await processAndStoreGalleryImage(buffer)

  const caption = form.get('caption')
  const category = form.get('category')

  const item = await cms.createGalleryItem(
    venueConfig.id,
    {
      storageKey,
      caption:
        typeof caption === 'string' && caption.trim() !== '' ? caption.trim().slice(0, 500) : null,
      category:
        typeof category === 'string' && category.trim() !== ''
          ? category.trim().slice(0, 100)
          : null,
      isPublished: form.get('isPublished') !== 'false',
    },
    session.adminId,
  )

  return apiSuccess({ item }, { status: 201, requestId })
})
