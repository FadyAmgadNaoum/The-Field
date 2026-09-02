import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/ui/cn'

/**
 * Class name utility (Doc 22 §11.10).
 *
 * The point of `cn` is not string concatenation — it is that a caller-supplied
 * class reliably beats a component's own default. Without the tailwind-merge
 * step the outcome would depend on stylesheet order, which is invisible until a
 * component looks wrong in one place and right in another.
 */
describe('cn', () => {
  it('joins class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('drops falsy values instead of emitting "false" or "undefined"', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b')
  })

  it('supports conditional object and array syntax', () => {
    expect(cn(['a', { b: true, c: false }])).toBe('a b')
  })

  it('resolves conflicting Tailwind utilities in favour of the last one', () => {
    // This is the behaviour the whole helper exists for.
    expect(cn('px-4', 'px-8')).toBe('px-8')
    expect(cn('text-ink-500', 'text-ink-900')).toBe('text-ink-900')
  })

  it('keeps utilities that only look similar', () => {
    // px and py are different axes and must both survive.
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2')
  })

  it('lets a caller override a component default', () => {
    const componentDefault = 'rounded-control bg-brand-700 px-5'
    expect(cn(componentDefault, 'bg-danger-600')).toContain('bg-danger-600')
    expect(cn(componentDefault, 'bg-danger-600')).not.toContain('bg-brand-700')
  })

  it('returns an empty string when given nothing', () => {
    expect(cn()).toBe('')
  })

  /**
   * Regression guard for a real defect.
   *
   * tailwind-merge classifies conflicts from Tailwind's DEFAULT theme. Our
   * custom font sizes share the `text-` prefix with text colours, so without
   * the `extendTailwindMerge` configuration in `cn.ts` the merge decided
   * `text-body-sm` was a colour, concluded it conflicted with `text-white`, and
   * dropped it — rendering every primary button as near-black text on dark
   * green at a 3.56:1 contrast ratio.
   *
   * The classes were all present in the source and TypeScript was satisfied;
   * only measuring painted colour found it. These assertions make the merge
   * configuration itself testable.
   */
  describe('custom theme scales are classified correctly', () => {
    it('keeps a text colour alongside a custom font size', () => {
      const merged = cn('bg-brand-700 text-white', 'text-body-sm')
      expect(merged).toContain('text-white')
      expect(merged).toContain('text-body-sm')
    })

    it.each([
      'body-sm',
      'body',
      'body-lg',
      'heading-sm',
      'heading',
      'heading-lg',
      'display',
      'display-lg',
    ])('keeps text-white alongside text-%s', (size) => {
      expect(cn('text-white', `text-${size}`)).toContain('text-white')
    })

    it('still treats two custom font sizes as conflicting', () => {
      expect(cn('text-body', 'text-display')).toBe('text-display')
    })

    it('still treats two text colours as conflicting', () => {
      expect(cn('text-ink-500', 'text-white')).toBe('text-white')
    })

    it('resolves custom radius, shadow and max-width scales', () => {
      expect(cn('rounded-card', 'rounded-pill')).toBe('rounded-pill')
      expect(cn('shadow-card', 'shadow-overlay')).toBe('shadow-overlay')
      expect(cn('max-w-content', 'max-w-prose')).toBe('max-w-prose')
    })
  })
})
