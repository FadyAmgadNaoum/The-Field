import { cn } from '@/lib/ui/cn'

/** Surface container. Used for court cards, pricing tables and form panels. */
export function Card({
  className,
  children,
  as: Element = 'div',
}: {
  className?: string
  children: React.ReactNode
  as?: 'div' | 'article' | 'li' | 'section'
}) {
  return (
    <Element
      className={cn(
        'overflow-hidden rounded-card border border-line bg-canvas shadow-card',
        className,
      )}
    >
      {children}
    </Element>
  )
}

export function CardBody({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return <div className={cn('p-5', className)}>{children}</div>
}

/**
 * A short label chip.
 *
 * `tone` never carries meaning alone — the caller always supplies text, so the
 * information survives for a colour-blind reader and in high-contrast mode
 * (Doc 03 NFR-ACC-004).
 */
export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'
  className?: string
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-ink-100 text-ink-700',
    brand: 'bg-brand-50 text-brand-800',
    success: 'bg-success-50 text-success-700',
    warning: 'bg-warning-50 text-warning-700',
    danger: 'bg-danger-50 text-danger-700',
    info: 'bg-info-50 text-info-700',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill px-2.5 py-1 text-body-sm font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
