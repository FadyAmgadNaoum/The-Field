'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Alert, Spinner } from '@/components/ui/feedback'
import { Field, inputStyles } from '@/components/ui/field'
import { AdminApiError, adminSend, adminUpload } from './admin-api'
import { UPLOAD_LIMITS } from '@/lib/validation/file'
import type { GalleryItem } from '@/modules/cms/cms.types'

/**
 * Gallery editor (Doc 22 M2-T09, Doc 09 §6.3).
 *
 * ── CLIENT-SIDE CHECKS ARE COURTESY ONLY ─────────────────────────────────────
 * The `accept` attribute and the size check below exist so an operator learns
 * about a 20MB TIFF before uploading it over a phone connection. Neither is a
 * control: the server re-reads the bytes, identifies the type by magic number,
 * enforces the same ceiling, and re-encodes the image — a request crafted
 * outside this form meets exactly the same pipeline (Doc 22 §9.4–9.5).
 *
 * ── ALT TEXT ─────────────────────────────────────────────────────────────────
 * The caption becomes the image's alt text on the public gallery. The help
 * text says so, because "caption" alone does not tell an operator that leaving
 * it blank affects screen-reader users (Doc 03 NFR-ACC-003).
 */

const MAX_MB = Math.round(UPLOAD_LIMITS.imageMaxBytes / 1024 / 1024)

export function CmsGalleryEditor({ initial }: { initial: GalleryItem[] }) {
  const router = useRouter()

  const [items, setItems] = useState<GalleryItem[]>(initial)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [fileError, setFileError] = useState<string | undefined>(undefined)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const form = event.currentTarget
    const data = new FormData(form)
    const file = data.get('file')

    setFileError(undefined)
    setMessage(null)

    if (!(file instanceof File) || file.size === 0) {
      setFileError('Choose an image to upload.')
      return
    }
    if (file.size > UPLOAD_LIMITS.imageMaxBytes) {
      setFileError(`That file is larger than ${MAX_MB}MB.`)
      return
    }

    setBusy(true)
    try {
      const result = await adminUpload<{ item: GalleryItem }>('/api/v1/admin/cms/gallery', data)
      setItems((current) => [...current, result.item])
      form.reset()
      setMessage({ tone: 'success', text: 'Image uploaded.' })
      router.refresh()
    } catch (error) {
      setMessage({
        tone: 'danger',
        text: error instanceof AdminApiError ? error.message : 'The upload failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: GalleryItem) {
    if (busy) return
    setBusy(true)
    setMessage(null)

    try {
      await adminSend('DELETE', `/api/v1/admin/cms/gallery/${item.id}`)
      setItems((current) => current.filter((i) => i.id !== item.id))
      setMessage({ tone: 'success', text: 'Image removed from the gallery.' })
      router.refresh()
    } catch (error) {
      setMessage({
        tone: 'danger',
        text: error instanceof AdminApiError ? error.message : 'The request failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {message ? (
        <Alert tone={message.tone} live="assertive">
          <p>{message.text}</p>
        </Alert>
      ) : null}

      <section
        aria-labelledby="gallery-upload-heading"
        className="rounded-card border border-line bg-white p-6"
      >
        <h2 id="gallery-upload-heading" className="text-heading-sm font-semibold text-ink-900">
          Upload an image
        </h2>

        <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
          <Field
            label="Image file"
            required
            help={`JPEG, PNG or WebP, up to ${MAX_MB}MB. Images are resized and converted automatically.`}
            error={fileError}
          >
            {(props) => (
              <input
                {...props}
                name="file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                required
                className="block w-full text-body-sm file:me-4 file:rounded-control file:border-0 file:bg-ink-900 file:px-4 file:py-2.5 file:text-body-sm file:font-medium file:text-white"
              />
            )}
          </Field>

          <Field
            label="Caption"
            help="Shown under the image and used as its alt text for screen readers. Leave blank for a purely decorative photo."
          >
            {(props) => (
              <input
                {...props}
                name="caption"
                type="text"
                maxLength={500}
                className={inputStyles}
              />
            )}
          </Field>

          <div>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner label="Uploading" /> : 'Upload'}
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="gallery-list-heading">
        <h2 id="gallery-list-heading" className="text-heading-sm font-semibold text-ink-900">
          Gallery ({items.length})
        </h2>

        {items.length === 0 ? (
          <p className="mt-3 text-body-sm text-ink-500">
            No images yet. The public gallery page shows a placeholder message until one is
            uploaded.
          </p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => (
              <li
                key={item.id}
                className="overflow-hidden rounded-card border border-line bg-white"
              >
                <div className="relative aspect-square bg-ink-100">
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt={item.caption ?? ''}
                      fill
                      sizes="(min-width: 1024px) 25vw, 50vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center p-2 text-center text-body-sm text-ink-500">
                      Preview unavailable — storage is not configured
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 p-3">
                  <p className="min-w-0 flex-1 truncate text-body-sm text-ink-700">
                    {item.caption ?? 'No caption'}
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => remove(item)} disabled={busy}>
                    <Trash2 aria-hidden className="h-4 w-4 text-danger-600" />
                    <span className="sr-only">Remove image {item.caption ?? item.id}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
