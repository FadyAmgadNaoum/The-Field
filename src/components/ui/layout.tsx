import { cn } from '@/lib/ui/cn'

/**
 * Page structure primitives (Doc 22 §11.10).
 *
 * Three components carry every page's rhythm, so spacing is decided once here
 * instead of being re-guessed on each page. Padding uses logical properties
 * where it differs by side, so the same markup is correct in RTL.
 */

/** Horizontal page gutter and maximum line length. */
export function Container({
  className,
  children,
  as: Element = 'div',
}: {
  className?: string
  children: React.ReactNode
  as?: 'div' | 'header' | 'footer' | 'section' | 'nav'
}) {
  return (
    <Element className={cn('mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8', className)}>
      {children}
    </Element>
  )
}

/** Vertical rhythm between page sections. Tighter on mobile. */
export function Section({
  className,
  children,
  id,
  'aria-labelledby': ariaLabelledBy,
}: {
  className?: string
  children: React.ReactNode
  id?: string
  'aria-labelledby'?: string
}) {
  return (
    <section id={id} aria-labelledby={ariaLabelledBy} className={cn('py-10 sm:py-14', className)}>
      {children}
    </section>
  )
}

/**
 * The heading block at the top of a page.
 *
 * Renders exactly one `<h1>`. Every public page uses this, which is what keeps
 * the document outline correct without each page having to remember the rule
 * (Doc 03 NFR-ACC-001).
 */
export function PageHeader({
  title,
  description,
  id = 'page-title',
}: {
  title: string
  description?: string
  id?: string
}) {
  return (
    <div className="max-w-prose">
      <h1 id={id} className="text-heading-lg font-semibold text-ink-900 sm:text-display">
        {title}
      </h1>
      {description ? <p className="mt-3 text-body text-ink-600">{description}</p> : null}
    </div>
  )
}
