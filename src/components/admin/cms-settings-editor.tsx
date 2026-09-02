'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, Spinner } from '@/components/ui/feedback'
import { Field, inputStyles } from '@/components/ui/field'
import { AdminApiError, adminSend } from './admin-api'
import type { CmsGroup, CmsSettingDefinition } from '@/modules/cms/cms.keys'

/**
 * CMS settings editor for one tab group (Doc 22 M2-T08, Doc 09 §6.1).
 *
 * ── ONE GROUP PER SAVE ───────────────────────────────────────────────────────
 * Doc 09 §6.1: "all settings in the tab group are saved in a single request".
 * The server validates the whole group and rejects the save if any field fails,
 * so the administrator never has to work out which half was written.
 *
 * ── THE INSTAPAY WARNING ─────────────────────────────────────────────────────
 * `venue.instapay_number` is the number customers transfer money to. While it
 * is empty the customer-facing payment step is disabled (Doc 24 §G.4), and no
 * placeholder exists anywhere in the codebase. The banner below states that
 * relationship so an operator understands what setting it switches on — and
 * what leaving it empty currently prevents.
 */

export interface SettingsGroupData {
  group: CmsGroup
  definitions: CmsSettingDefinition[]
  values: Record<string, string | null | undefined>
}

const MULTILINE_TYPES = new Set(['textarea', 'markdown'])

export function CmsSettingsEditor({ initial }: { initial: SettingsGroupData }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.definitions.map((d) => [d.key, initial.values[d.key] ?? ''])),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({})

  const hasInstapay = initial.definitions.some((d) => d.key === 'venue.instapay_number')
  const instapayEmpty = (values['venue.instapay_number'] ?? '') === ''

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) return

    setIsSaving(true)
    setStatus('idle')
    setMessage(null)
    setFieldErrors({})

    try {
      await adminSend('PUT', '/api/v1/admin/cms/settings', {
        group: initial.group,
        settings: values,
      })
      setStatus('saved')
      setMessage('Saved. The public site shows the change on its next load.')
    } catch (error) {
      setStatus('error')
      if (error instanceof AdminApiError) {
        setMessage(error.message)
        setFieldErrors(
          Object.fromEntries(
            Object.entries(error.fieldErrors).map(([key, messages]) => [key, messages?.[0]]),
          ),
        )
      } else {
        setMessage('The request failed.')
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {hasInstapay && instapayEmpty ? (
        <Alert tone="warning" title="InstaPay number is not set">
          <p>
            Customers cannot be shown payment instructions until this is filled in, and booking
            submission stays disabled. Confirm the number with the venue owner before entering it —
            no default or example value exists anywhere in this system.
          </p>
        </Alert>
      ) : null}

      {message ? (
        <Alert tone={status === 'saved' ? 'success' : 'danger'} live="assertive">
          <p>{message}</p>
        </Alert>
      ) : null}

      {initial.definitions.map((definition) => (
        <Field
          key={definition.key}
          label={definition.label}
          help={definition.help}
          error={fieldErrors[definition.key]}
        >
          {(props) =>
            MULTILINE_TYPES.has(definition.valueType) ? (
              <textarea
                {...props}
                rows={definition.valueType === 'markdown' ? 8 : 3}
                value={values[definition.key] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [definition.key]: event.target.value }))
                }
                className={inputStyles}
              />
            ) : (
              <input
                {...props}
                type="text"
                dir="ltr"
                value={values[definition.key] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [definition.key]: event.target.value }))
                }
                className={inputStyles}
              />
            )
          }
        </Field>
      ))}

      <div>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? <Spinner label="Saving" /> : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
