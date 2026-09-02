'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Alert, Spinner } from '@/components/ui/feedback'
import { Field, inputStyles } from '@/components/ui/field'
import { AdminApiError, adminSend } from './admin-api'
import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  type SocialLink,
  type SocialPlatform,
} from '@/modules/cms/cms.types'

/**
 * Social links editor (Doc 22 M2-T09, Doc 09 §6.6).
 *
 * One row per platform from a fixed list. Saving a platform with an empty URL
 * clears it — the public footer only renders active links that have a
 * destination, so there is no state in which a customer can click an anchor
 * that goes nowhere.
 *
 * Each platform saves independently: a typo in one URL must not block saving
 * the other four.
 */

export function CmsSocialEditor({ initial }: { initial: SocialLink[] }) {
  const router = useRouter()

  const byPlatform = new Map(initial.map((link) => [link.platform, link]))

  const [values, setValues] = useState<Record<string, { url: string; isActive: boolean }>>(() =>
    Object.fromEntries(
      SOCIAL_PLATFORMS.map((platform) => [
        platform,
        {
          url: byPlatform.get(platform)?.url ?? '',
          isActive: byPlatform.get(platform)?.isActive ?? true,
        },
      ]),
    ),
  )

  const [busyPlatform, setBusyPlatform] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  async function save(platform: SocialPlatform) {
    if (busyPlatform) return

    setBusyPlatform(platform)
    setMessage(null)
    setErrors((current) => ({ ...current, [platform]: undefined }))

    const entry = values[platform] ?? { url: '', isActive: true }

    try {
      await adminSend('PUT', '/api/v1/admin/cms/social', {
        platform,
        url: entry.url.trim(),
        isActive: entry.isActive,
      })
      setMessage({
        tone: 'success',
        text:
          entry.url.trim() === ''
            ? `${SOCIAL_PLATFORM_LABELS[platform]} link cleared.`
            : `${SOCIAL_PLATFORM_LABELS[platform]} link saved.`,
      })
      router.refresh()
    } catch (error) {
      if (error instanceof AdminApiError) {
        setErrors((current) => ({
          ...current,
          [platform]: error.fieldError('url') ?? error.message,
        }))
        setMessage({ tone: 'danger', text: error.message })
      } else {
        setMessage({ tone: 'danger', text: 'The request failed.' })
      }
    } finally {
      setBusyPlatform(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {message ? (
        <Alert tone={message.tone} live="assertive">
          <p>{message.text}</p>
        </Alert>
      ) : null}

      <ul className="flex flex-col gap-4">
        {SOCIAL_PLATFORMS.map((platform) => {
          const entry = values[platform] ?? { url: '', isActive: true }

          return (
            <li key={platform} className="rounded-card border border-line bg-white p-5">
              <Field
                label={SOCIAL_PLATFORM_LABELS[platform]}
                help="Full HTTPS profile URL. Leave empty to clear the link and hide it from the footer."
                error={errors[platform]}
              >
                {(props) => (
                  <input
                    {...props}
                    type="url"
                    dir="ltr"
                    inputMode="url"
                    maxLength={500}
                    placeholder="https://"
                    value={entry.url}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [platform]: { ...entry, url: event.target.value },
                      }))
                    }
                    className={inputStyles}
                  />
                )}
              </Field>

              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-body-sm text-ink-800">
                  <input
                    type="checkbox"
                    checked={entry.isActive}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [platform]: { ...entry, isActive: event.target.checked },
                      }))
                    }
                    className="h-4 w-4"
                  />
                  Show in the website footer
                </label>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => save(platform)}
                  disabled={busyPlatform !== null}
                >
                  {busyPlatform === platform ? (
                    <Spinner label={`Saving ${SOCIAL_PLATFORM_LABELS[platform]}`} />
                  ) : (
                    'Save'
                  )}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
