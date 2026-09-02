import { cn } from '@/lib/ui/cn'

/**
 * Button styling (Doc 22 §11.10, Doc 03 NFR-ACC-002).
 *
 * Exported as a style FUNCTION rather than only a component, because the same
 * appearance is needed on three different elements: `<button>` for actions,
 * next-intl's `<Link>` for navigation, and `<a>` for external destinations.
 * Wrapping a link in a button — or a button in a link — produces invalid HTML
 * and breaks keyboard and screen-reader behaviour, so the shared thing here is
 * the styling, not the element.
 *
 * Every variant meets the 44px minimum target height and carries a visible
 * focus ring from the global `:focus-visible` rule.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900',
  secondary: 'bg-white text-ink-900 border border-line hover:bg-ink-50 active:bg-ink-100',
  ghost: 'bg-transparent text-ink-700 hover:bg-ink-100 active:bg-ink-200',
  danger: 'bg-danger-600 text-white hover:bg-danger-700',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-touch px-3.5 py-2 text-body-sm',
  md: 'min-h-touch px-5 py-2.5 text-body',
  lg: 'min-h-touch px-6 py-3 text-body-lg',
}

export function buttonStyles(
  options: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean } = {},
): string {
  const { variant = 'primary', size = 'md', fullWidth = false } = options

  return cn(
    'inline-flex items-center justify-center gap-2 rounded-control font-medium',
    'transition-colors duration-150',
    // A disabled control must still be perceivable — dimmed, not invisible.
    'disabled:pointer-events-none disabled:opacity-60',
    VARIANTS[variant],
    SIZES[size],
    fullWidth && 'w-full',
  )
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}

export function Button({
  variant,
  size,
  fullWidth,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  // `type` defaults to "button". An unspecified type inside a form is "submit",
  // which turns every incidental button into an accidental form submission.
  return (
    <button
      type={type}
      className={cn(buttonStyles({ variant, size, fullWidth }), className)}
      {...props}
    />
  )
}
