'use client'

import { useId } from 'react'
import { cn } from '@/lib/ui/cn'

/**
 * Form field primitives (Doc 03 NFR-ACC-002, NFR-ACC-006).
 *
 * ── WHAT THIS COMPONENT GUARANTEES ───────────────────────────────────────────
 *  - every control has a real `<label for>`, not a placeholder standing in for one
 *  - help text and error text are wired to the control through `aria-describedby`
 *  - an invalid control carries `aria-invalid`, and its error is announced
 *  - the error is rendered as text, so it survives without colour
 *
 * These are the properties an accessibility audit actually checks, and they are
 * easy to lose when each form hand-rolls its own markup. Every input on the
 * public site goes through here so none of them can.
 */

export const inputStyles = cn(
  'block w-full rounded-control border border-line bg-canvas px-3.5 py-2.5',
  // 16px minimum: anything smaller makes iOS Safari zoom on focus, which breaks
  // the layout on a 390px viewport.
  'text-body text-ink-900 placeholder:text-ink-400',
  'min-h-touch',
  'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-500',
  'aria-[invalid=true]:border-danger-600',
)

export interface FieldProps {
  label: string
  /** Rendered under the control. Explains the value, not the error. */
  help?: string
  error?: string | null
  required?: boolean
  className?: string
  /**
   * Receives the ids to attach. The caller owns the control element so this
   * works equally for input, textarea and select without a prop for each.
   */
  children: (props: {
    id: string
    'aria-describedby': string | undefined
    'aria-invalid': boolean | undefined
    'aria-required': boolean | undefined
  }) => React.ReactNode
}

export function Field({ label, help, error, required, className, children }: FieldProps) {
  const reactId = useId()
  const id = `field-${reactId}`
  const helpId = help ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined

  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-body-sm font-medium text-ink-800">
        {label}
        {required ? (
          <span aria-hidden className="ms-1 text-danger-600">
            *
          </span>
        ) : null}
      </label>

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
      })}

      {help ? (
        <p id={helpId} className="text-body-sm text-ink-500">
          {help}
        </p>
      ) : null}

      {error ? (
        // `role="alert"` so the message is announced when it appears after a
        // failed submission, not only when the field is next focused.
        <p id={errorId} role="alert" className="text-body-sm font-medium text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Visually hidden but reachable by assistive technology. */
export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return <span className="sr-only">{children}</span>
}
