'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Alert, Spinner } from '@/components/ui/feedback'
import { Badge } from '@/components/ui/card'
import { Field, inputStyles } from '@/components/ui/field'
import { AdminApiError, adminSend } from './admin-api'
import type { CmsEventItem } from '@/modules/cms/cms.types'

/**
 * Events editor (Doc 22 M2-T09, Doc 09 §6.4).
 *
 * ── SCOPE AT THIS MILESTONE ──────────────────────────────────────────────────
 * Create, publish and remove. There is no public events PAGE yet: Doc 18 M5
 * assigns "Events public page" to the content milestone, and Doc 22 M2-T06's
 * page list does not include it. The editor exists here because M2-T09 lists it
 * among the collection editors, and the data it writes is ready for the public
 * page when that milestone builds it.
 *
 * ── DATES ────────────────────────────────────────────────────────────────────
 * `eventDate` is a plain 'YYYY-MM-DD' business date and `eventTime` a wall-clock
 * 'HH:MM', matching the DATE and TIME columns. Neither is converted through a
 * `Date` object, so neither can shift by a day across a timezone boundary
 * (Doc 22 §8.1, Doc 24 §D.2). Past dates are permitted — Doc 09 §7 allows them
 * for archives.
 */

export function CmsEventsEditor({ initial }: { initial: CmsEventItem[] }) {
  const router = useRouter()

  const [events, setEvents] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({})

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const form = event.currentTarget
    const data = new FormData(form)

    const title = String(data.get('title') ?? '')
    const description = String(data.get('description') ?? '')
    const eventDate = String(data.get('eventDate') ?? '')
    const eventTime = String(data.get('eventTime') ?? '')
    const isPublished = data.get('isPublished') === 'on'

    setBusy(true)
    setMessage(null)
    setFieldErrors({})

    try {
      const created = await adminSend<{ event: { id: string } }>(
        'POST',
        '/api/v1/admin/cms/events',
        {
          title,
          isPublished,
          ...(description ? { description } : {}),
          ...(eventDate ? { eventDate } : {}),
          ...(eventTime ? { eventTime } : {}),
        },
      )

      setEvents((current) => [
        ...current,
        {
          id: created.event.id,
          title,
          slug: null,
          description: description || null,
          eventDate: eventDate || null,
          eventTime: eventTime || null,
          coverImageUrl: null,
          isPublished,
        },
      ])
      form.reset()
      setMessage({ tone: 'success', text: 'Event created.' })
      router.refresh()
    } catch (error) {
      if (error instanceof AdminApiError) {
        setMessage({ tone: 'danger', text: error.message })
        setFieldErrors({
          title: error.fieldError('title'),
          eventDate: error.fieldError('eventDate'),
          eventTime: error.fieldError('eventTime'),
        })
      } else {
        setMessage({ tone: 'danger', text: 'The request failed.' })
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (busy) return
    setBusy(true)
    setMessage(null)

    try {
      await adminSend('DELETE', `/api/v1/admin/cms/events/${id}`)
      setEvents((current) => current.filter((item) => item.id !== id))
      setMessage({ tone: 'success', text: 'Event removed.' })
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

      <Alert tone="info">
        <p>
          Events are stored and managed here. The public events page is built in a later milestone,
          so published events are not yet visible on the website.
        </p>
      </Alert>

      <section
        aria-labelledby="event-form-heading"
        className="rounded-card border border-line bg-white p-6"
      >
        <h2 id="event-form-heading" className="text-heading-sm font-semibold text-ink-900">
          New event
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

          <Field label="Description" help="Optional.">
            {(props) => (
              <textarea
                {...props}
                name="description"
                rows={4}
                maxLength={5000}
                className={inputStyles}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Date"
              help="Optional. Past dates are allowed."
              error={fieldErrors.eventDate}
            >
              {(props) => <input {...props} name="eventDate" type="date" className={inputStyles} />}
            </Field>

            <Field
              label="Start time"
              help="Optional. Venue local time."
              error={fieldErrors.eventTime}
            >
              {(props) => <input {...props} name="eventTime" type="time" className={inputStyles} />}
            </Field>
          </div>

          <label className="flex items-center gap-2 text-body-sm text-ink-800">
            <input type="checkbox" name="isPublished" className="h-4 w-4" />
            Published
          </label>

          <div>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner label="Saving" /> : 'Create event'}
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="event-list-heading">
        <h2 id="event-list-heading" className="text-heading-sm font-semibold text-ink-900">
          Events ({events.length})
        </h2>

        {events.length === 0 ? (
          <p className="mt-3 text-body-sm text-ink-500">No events.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {events.map((item) => (
              <li key={item.id} className="rounded-card border border-line bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-body font-medium text-ink-900">{item.title}</p>
                      <Badge tone={item.isPublished ? 'success' : 'neutral'}>
                        {item.isPublished ? 'Published' : 'Draft'}
                      </Badge>
                    </div>
                    {item.eventDate ? (
                      <p className="mt-1 text-body-sm text-ink-600">
                        {item.eventDate}
                        {item.eventTime ? ` · ${item.eventTime.slice(0, 5)}` : ''}
                      </p>
                    ) : null}
                  </div>

                  <Button variant="ghost" size="sm" onClick={() => remove(item.id)} disabled={busy}>
                    <Trash2 aria-hidden className="h-4 w-4 text-danger-600" />
                    <span className="sr-only">Remove event: {item.title}</span>
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
