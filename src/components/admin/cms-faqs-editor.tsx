'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Alert, Spinner } from '@/components/ui/feedback'
import { Field, inputStyles } from '@/components/ui/field'
import { AdminApiError, adminSend } from './admin-api'
import type { Faq } from '@/modules/cms/cms.types'

/**
 * FAQ editor (Doc 22 M2-T09, Doc 09 §6.2).
 *
 * ── ON "DRAG TO REORDER" ─────────────────────────────────────────────────────
 * Doc 09 §6.2 describes drag-to-reorder. Reordering here is done with Move up /
 * Move down buttons instead. Drag-and-drop is only operable with a pointer
 * unless a parallel keyboard interface is built alongside it, and Doc 03
 * NFR-ACC-002 requires every interactive element to be keyboard navigable — so
 * a drag implementation would need these buttons anyway. They hit the same
 * `POST /api/v1/admin/cms/faqs/reorder` endpoint, which applies the whole
 * ordering in one transaction.
 *
 * Recorded as a deliberate deviation in the Milestone 2 report.
 */

export function CmsFaqsEditor({ initial }: { initial: Faq[] }) {
  const router = useRouter()

  const [faqs, setFaqs] = useState<Faq[]>(initial)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({})
  const [editing, setEditing] = useState<Faq | null>(null)

  function report(error: unknown) {
    if (error instanceof AdminApiError) {
      setMessage({ tone: 'danger', text: error.message })
      setFieldErrors({
        question: error.fieldError('question'),
        answer: error.fieldError('answer'),
      })
    } else {
      setMessage({ tone: 'danger', text: 'The request failed.' })
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const form = event.currentTarget
    const data = new FormData(form)
    const payload = {
      question: String(data.get('question') ?? ''),
      answer: String(data.get('answer') ?? ''),
      isPublished: data.get('isPublished') === 'on',
    }

    setBusy(true)
    setMessage(null)
    setFieldErrors({})

    try {
      if (editing) {
        const result = await adminSend<{ faq: Faq }>(
          'PUT',
          `/api/v1/admin/cms/faqs/${editing.id}`,
          payload,
        )
        setFaqs((current) => current.map((f) => (f.id === editing.id ? result.faq : f)))
        setEditing(null)
      } else {
        const result = await adminSend<{ faq: Faq }>('POST', '/api/v1/admin/cms/faqs', payload)
        setFaqs((current) => [...current, result.faq])
      }
      form.reset()
      setMessage({ tone: 'success', text: 'Saved.' })
      // The public FAQ page is a separate cache entry; refreshing the router
      // means the admin list and the site agree without a manual reload.
      router.refresh()
    } catch (error) {
      report(error)
    } finally {
      setBusy(false)
    }
  }

  async function remove(faq: Faq) {
    if (busy) return
    setBusy(true)
    setMessage(null)

    try {
      await adminSend('DELETE', `/api/v1/admin/cms/faqs/${faq.id}`)
      setFaqs((current) => current.filter((f) => f.id !== faq.id))
      if (editing?.id === faq.id) setEditing(null)
      setMessage({ tone: 'success', text: 'Removed.' })
      router.refresh()
    } catch (error) {
      report(error)
    } finally {
      setBusy(false)
    }
  }

  async function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (busy || target < 0 || target >= faqs.length) return

    const reordered = [...faqs]
    const [moved] = reordered.splice(index, 1)
    if (!moved) return
    reordered.splice(target, 0, moved)

    // Optimistic: the list reorders immediately and is reverted if the write
    // fails, so a keyboard user pressing the button repeatedly is not fighting
    // a round trip on each press.
    const previous = faqs
    setFaqs(reordered)
    setBusy(true)

    try {
      await adminSend('POST', '/api/v1/admin/cms/faqs/reorder', {
        orderedIds: reordered.map((f) => f.id),
      })
      router.refresh()
    } catch (error) {
      setFaqs(previous)
      report(error)
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
        aria-labelledby="faq-form-heading"
        className="rounded-card border border-line bg-white p-6"
      >
        <h2 id="faq-form-heading" className="text-heading-sm font-semibold text-ink-900">
          {editing ? 'Edit question' : 'Add a question'}
        </h2>

        <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
          <Field label="Question" required error={fieldErrors.question}>
            {(props) => (
              <input
                {...props}
                name="question"
                type="text"
                required
                minLength={5}
                maxLength={500}
                defaultValue={editing?.question ?? ''}
                key={`q-${editing?.id ?? 'new'}`}
                className={inputStyles}
              />
            )}
          </Field>

          <Field label="Answer" required error={fieldErrors.answer}>
            {(props) => (
              <textarea
                {...props}
                name="answer"
                rows={5}
                required
                minLength={10}
                maxLength={5000}
                defaultValue={editing?.answer ?? ''}
                key={`a-${editing?.id ?? 'new'}`}
                className={inputStyles}
              />
            )}
          </Field>

          <label className="flex items-center gap-2 text-body-sm text-ink-800">
            <input
              type="checkbox"
              name="isPublished"
              defaultChecked={editing ? editing.isPublished : true}
              key={`p-${editing?.id ?? 'new'}`}
              className="h-4 w-4"
            />
            Published on the public FAQ page
          </label>

          <div className="flex gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner label="Saving" /> : editing ? 'Save changes' : 'Add question'}
            </Button>
            {editing ? (
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </section>

      <section aria-labelledby="faq-list-heading">
        <h2 id="faq-list-heading" className="text-heading-sm font-semibold text-ink-900">
          Questions ({faqs.length})
        </h2>

        {faqs.length === 0 ? (
          <p className="mt-3 text-body-sm text-ink-500">
            No questions yet. The public FAQ page shows a placeholder until one is published.
          </p>
        ) : (
          <ol className="mt-4 flex flex-col gap-3">
            {faqs.map((faq, index) => (
              <li key={faq.id} className="rounded-card border border-line bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-medium text-ink-900">{faq.question}</p>
                    <p className="mt-1 line-clamp-2 text-body-sm text-ink-600">{faq.answer}</p>
                    {!faq.isPublished ? (
                      <p className="mt-2 text-body-sm font-medium text-warning-700">
                        Not published — hidden from the public page
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => move(index, -1)}
                      disabled={busy || index === 0}
                    >
                      <ArrowUp aria-hidden className="h-4 w-4" />
                      <span className="sr-only">Move up: {faq.question}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => move(index, 1)}
                      disabled={busy || index === faqs.length - 1}
                    >
                      <ArrowDown aria-hidden className="h-4 w-4" />
                      <span className="sr-only">Move down: {faq.question}</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditing(faq)}
                      disabled={busy}
                    >
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(faq)} disabled={busy}>
                      <Trash2 aria-hidden className="h-4 w-4 text-danger-600" />
                      <span className="sr-only">Remove: {faq.question}</span>
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
