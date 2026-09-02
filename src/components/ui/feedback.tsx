import { AlertTriangle, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/ui/cn'

/**
 * Status, empty and loading presentation (Doc 22 §11.10, Doc 03 NFR-ACC-004).
 *
 * ── COLOUR IS NEVER THE MESSAGE ──────────────────────────────────────────────
 * Every alert carries an icon AND text. The icon is `aria-hidden` because it
 * duplicates the text rather than adding to it; the text is what a screen
 * reader announces and what a colour-blind reader relies on.
 */

export type AlertTone = 'info' | 'success' | 'warning' | 'danger'

const TONE_STYLES: Record<AlertTone, { box: string; icon: string }> = {
  info: { box: 'border-info-600/20 bg-info-50 text-info-700', icon: 'text-info-600' },
  success: {
    box: 'border-success-600/20 bg-success-50 text-success-700',
    icon: 'text-success-600',
  },
  warning: {
    box: 'border-warning-600/20 bg-warning-50 text-warning-700',
    icon: 'text-warning-600',
  },
  danger: { box: 'border-danger-600/20 bg-danger-50 text-danger-700', icon: 'text-danger-600' },
}

const TONE_ICONS: Record<AlertTone, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: AlertTriangle,
}

export function Alert({
  tone = 'info',
  title,
  children,
  className,
  /**
   * `assertive` for a message that appeared in response to the user's action
   * and blocks them; `polite` for status that can wait for a pause.
   */
  live,
}: {
  tone?: AlertTone
  title?: string
  children?: React.ReactNode
  className?: string
  live?: 'polite' | 'assertive'
}) {
  const Icon = TONE_ICONS[tone]

  return (
    <div
      className={cn('flex gap-3 rounded-card border p-4', TONE_STYLES[tone].box, className)}
      role={live === 'assertive' ? 'alert' : undefined}
      aria-live={live}
    >
      <Icon aria-hidden className={cn('mt-0.5 h-5 w-5 shrink-0', TONE_STYLES[tone].icon)} />
      <div className="min-w-0 text-body-sm">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-1')}>{children}</div> : null}
      </div>
    </div>
  )
}

/**
 * The "nothing here yet" state.
 *
 * Doc 22 §10.5 requires a meaningful message wherever CMS content or venue data
 * is absent, rather than a blank region that reads as a broken page.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-card border border-dashed border-ink-300 bg-subtle px-6 py-12 text-center">
      <p className="text-body-lg font-medium text-ink-800">{title}</p>
      {description ? (
        <p className="mx-auto mt-2 max-w-prose text-body-sm text-ink-600">{description}</p>
      ) : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  )
}

/**
 * Busy indicator.
 *
 * The animation is a CSS transform, which the global reduced-motion rule
 * neutralises. The accessible name is supplied by the caller and announced
 * politely, so the state is conveyed even when the spinner is not (Doc 23
 * REL-M2-T03).
 */
export function Spinner({ label, className }: { label: string; className?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <span
        aria-hidden
        className={cn(
          'h-4 w-4 animate-spin rounded-full border-2 border-current border-e-transparent',
          className,
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** Skeleton block for a loading region. Fixed height, so nothing shifts. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-control bg-ink-200', className)} />
}
