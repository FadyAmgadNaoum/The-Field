'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Alert, Spinner } from '@/components/ui/feedback'
import { Badge } from '@/components/ui/card'
import { Field, inputStyles } from '@/components/ui/field'
import { AdminApiError, adminSend } from './admin-api'

/**
 * Announcements editor (Doc 22 M2-T09, Doc 09 §6.5).
 *
 * Published, unexpired announcements appear as a banner at the top of the home
 * page. Expiry is optional; when set it must be in the future, which the server
 * enforces — the `min` attribute below only saves a round trip.
 *
 * `expiresAt` travels as an ISO instant with an offset. The `datetime-local`
 * control produces a value in the OPERATOR's timezone, which is converted here
 * rather than sent as a naive string that the server would have to guess at.
 */

export interface AdminAnnouncement {
  id: string
  title: string
  body: string
  expiresAt: string | Date | null
  isPublished: boolean
}

function isExpired(expiresAt: string | Date | null): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= Date.now()
}

function toLocalInputValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

export function CmsAnnouncementsEditor({ initial }: { initial: AdminAnnouncement[] }) {
  const router = useRouter()

  const [items, setItems] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({})

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const form = event.currentTarget
    const data = new FormData(form)
    const rawExpiry = String(data.get('expiresAt') ?? '')

    setBusy(true)
    setMessage(null)
    setFieldErrors({})

    try {
      const created = await adminSend<{ announcement: { id: string } }>(
        'POST',
        '/api/v1/admin/cms/announcements',
        {
          title: String(data.get('title') ?? ''),
          body: String(data.get('body') ?? ''),
          isPublished: data.get('isPublished') === 'on',
          ...(rawExpiry ? { expiresAt: new Date(rawExpiry).toISOString() } : {}),
        },
      )

      setItems((current) => [
        ...current,
        {
          id: created.announcement.id,
          title: String(data.get('title') ?? ''),
          body: String(data.get('body') ?? ''),
          expiresAt: rawExpiry ? new Date(rawExpiry).toISOString() : null,
          isPublished: data.get('isPublished') === 'on',
        },
      ])
      form.reset()
      setMessage({ tone: 'success', text: 'Announcement created.' })
      router.refresh()
    } catch (error) {
      if (error instanceof AdminApiError) {
        setMessage({ tone: 'danger', text: error.message })
        setFieldErrors({
          title: error.fieldError('title'),
          body: error.fieldError('body'),
          expiresAt: error.fieldError('expiresAt'),
        })
      } else {
        setMessage({ tone: 'danger', text: 'The request failed.' })
      }
    } finally {
      setBusy(false)
    }
  }

  /**
   * Take an announcement off the site.
   *
   * The row is retired, not deleted — unpublished with a back-dated expiry —
   * because the runtime database role holds no DELETE right. The banner
   * disappears from the home page immediately; the entry stays here marked
   * Expired so the history is legible. The local state is updated to match
   * rather than dropping the item, so the list does not disagree with the
   * database until the next refresh.
   */
  async function retire(id: string) {
    if (busy) return
    setBusy(true)
    setMessage(null)

    try {
      await adminSend('DELETE', `/api/v1/admin/cms/announcements/${id}`)
      setItems((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, isPublished: false, expiresAt: new Date().toISOString() }
            : item,
        ),
      )
      setMessage({ tone: 'success', text: 'Announcement removed from the home page.' })
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
        aria-labelledby="announcement-form-heading"
        className="rounded-card border border-line bg-white p-6"
      >
        <h2 id="announcement-form-heading" className="text-heading-sm font-semibold text-ink-900">
          New announcement
        </h2>

        <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
          <Field label="Title" required error={fieldErrors.title}>
            {(props) => (
              <input
                {...props}
                name="title"
                type="text"
                required
                maxLength={255}
                className={inputStyles}
              />
            )}
          </Field>

          <Field label="Message" required error={fieldErrors.body}>
            {(props) => (
              <textarea
                {...props}
                name="body"
                rows={4}
                required
                maxLength={5000}
                className={inputStyles}
              />
            )}
          </Field>

          <Field
            label="Expires"
            help="Optional. After this time the announcement disappears from the home page."
            error={fieldErrors.expiresAt}
          >
            {(props) => (
              <input
                {...props}
                name="expiresAt"
                type="datetime-local"
                min={toLocalInputValue(new Date())}
                className={inputStyles}
              />
            )}
          </Field>

          <label className="flex items-center gap-2 text-body-sm text-ink-800">
            <input type="checkbox" name="isPublished" className="h-4 w-4" />
            Publish immediately
          </label>

          <div>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner label="Saving" /> : 'Create announcement'}
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="announcement-list-heading">
        <h2 id="announcement-list-heading" className="text-heading-sm font-semibold text-ink-900">
          Announcements ({items.length})
        </h2>

        {items.length === 0 ? (
          <p className="mt-3 text-body-sm text-ink-500">No announcements.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.id} className="rounded-card border border-line bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-body font-medium text-ink-900">{item.title}</p>
                      {/* Status is stated in words, not only by colour. */}
                      {!item.isPublished ? <Badge tone="neutral">Draft</Badge> : null}
                      {isExpired(item.expiresAt) ? <Badge tone="warning">Expired</Badge> : null}
                      {item.isPublished && !isExpired(item.expiresAt) ? (
                        <Badge tone="success">Live on the home page</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-body-sm text-ink-600">{item.body}</p>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => retire(item.id)}
                    disabled={busy || (!item.isPublished && isExpired(item.expiresAt))}
                  >
                    <Trash2 aria-hidden className="h-4 w-4 text-danger-600" />
                    <span className="sr-only">Remove from the home page: {item.title}</span>
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
