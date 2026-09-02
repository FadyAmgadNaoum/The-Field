'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Alert, Spinner } from '@/components/ui/feedback'
import { Badge, Card, CardBody } from '@/components/ui/card'
import { Field, inputStyles } from '@/components/ui/field'
import { ApiRequestError, postJson } from '@/lib/ui/api-client'
import { formatBusinessDate, formatMoney, formatTimeRange } from '@/lib/ui/format'

/**
 * Booking status lookup (Doc 22 M2-T10, Doc 10 §3.5).
 *
 * ── EVERYTHING SHOWN CAME FROM THE SERVER ────────────────────────────────────
 * This component renders exactly the fields `POST /api/v1/booking-status`
 * returned and derives nothing. In particular it does NOT decide whether a
 * booking may receive a payment proof: `awaitingPaymentProof` is computed
 * server-side from the stored status, and the upload endpoint re-checks
 * eligibility independently when it arrives in Milestone 4. A customer editing
 * this value in the browser changes what they see and nothing else
 * (Doc 24 §M item 3).
 *
 * ── ERRORS ───────────────────────────────────────────────────────────────────
 * A reference that does not exist and one that belongs to someone else both
 * produce the same 404 from the server, and this component shows the same
 * message for both, so the UI does not reintroduce the distinction the API
 * deliberately removed (Doc 13 T-004).
 */

interface BookingStatusResult {
  reference: string
  status: string
  courtName: string | null
  date: string
  startTime: string
  endTime: string
  price: { amount: string; currency: string }
  payment: { status: string | null; rejectionReason: string | null }
  reason: string | null
  awaitingPaymentProof: boolean
}

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  pending: 'warning',
  payment_submitted: 'info',
  under_review: 'info',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
}

export function BookingStatusLookup() {
  const t = useTranslations('bookingStatus')
  const tErrors = useTranslations('errors')
  const locale = useLocale()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BookingStatusResult | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    setIsSubmitting(true)
    setError(null)
    setResult(null)

    const reference = String(new FormData(event.currentTarget).get('reference') ?? '').trim()

    try {
      const data = await postJson<{ booking: BookingStatusResult }>('/api/v1/booking-status', {
        reference,
      })
      setResult(data.booking)
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        // NOT_FOUND is the expected answer for a typo and for someone else's
        // reference alike, so it gets the neutral wording rather than the
        // generic catalogue message.
        setError(
          caught.code === 'NOT_FOUND'
            ? t('notFound')
            : caught.message || tErrors(caught.code as never),
        )
      } else {
        setError(tErrors('INTERNAL_ERROR'))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardBody className="p-6">
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <Field label={t('referenceLabel')} help={t('referenceHint')} required>
              {(props) => (
                <input
                  {...props}
                  name="reference"
                  type="text"
                  // A booking reference is a left-to-right code even in Arabic.
                  dir="ltr"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  maxLength={20}
                  placeholder={t('referencePlaceholder')}
                  className={`${inputStyles} font-mono uppercase`}
                />
              )}
            </Field>

            <div>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Spinner label={t('submitting')} /> : t('submit')}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {error ? (
        <Alert tone="warning" live="assertive">
          <p>{error}</p>
        </Alert>
      ) : null}

      {result ? (
        <Card as="section" aria-live="polite">
          <CardBody className="flex flex-col gap-5 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-mono text-heading-sm font-semibold text-ink-900" dir="ltr">
                {result.reference}
              </h2>
              {/* Tone plus text: the status never depends on colour alone. */}
              <Badge tone={STATUS_TONE[result.status] ?? 'neutral'}>
                {t(`status.${result.status}` as never)}
              </Badge>
            </div>

            <p className="text-body-sm text-ink-600">{t(`statusHelp.${result.status}` as never)}</p>

            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-body-sm text-ink-500">{t('courtLabel')}</dt>
                <dd className="mt-0.5 text-body font-medium text-ink-900">
                  {result.courtName ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-body-sm text-ink-500">{t('dateLabel')}</dt>
                <dd className="mt-0.5 text-body font-medium text-ink-900">
                  {formatBusinessDate(locale, result.date)}
                </dd>
              </div>
              <div>
                <dt className="text-body-sm text-ink-500">{t('timeLabel')}</dt>
                <dd className="mt-0.5 text-body font-medium text-ink-900">
                  {formatTimeRange(locale, result.startTime, result.endTime)}
                </dd>
              </div>
              <div>
                <dt className="text-body-sm text-ink-500">{t('priceLabel')}</dt>
                <dd className="mt-0.5 text-body font-medium text-ink-900">
                  {formatMoney(locale, result.price.amount, result.price.currency)}
                </dd>
              </div>
              {result.payment.status ? (
                <div>
                  <dt className="text-body-sm text-ink-500">{t('paymentStatusLabel')}</dt>
                  <dd className="mt-0.5 text-body font-medium text-ink-900">
                    {t(`payment.${result.payment.status}` as never)}
                  </dd>
                </div>
              ) : null}
            </dl>

            {result.reason ? (
              <Alert tone="danger" title={t('rejectionReasonLabel')}>
                {/* Administrator-authored text, rendered as text. */}
                <p className="whitespace-pre-line">{result.reason}</p>
              </Alert>
            ) : null}

            {result.payment.rejectionReason ? (
              <Alert tone="warning" title={t('rejectionReasonLabel')}>
                <p className="whitespace-pre-line">{result.payment.rejectionReason}</p>
              </Alert>
            ) : null}

            {/*
              The proof-upload section appears only when the SERVER said this
              booking is awaiting proof. The upload control itself arrives with
              the payment workflow in Milestone 4 (Doc 24 §N); until then the
              section states what the customer needs to do rather than offering
              a control that cannot work.
            */}
            {result.awaitingPaymentProof ? (
              <Alert tone="info" title={t('uploadProofHeading')}>
                <p>{t('uploadProofBody')}</p>
              </Alert>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  )
}
