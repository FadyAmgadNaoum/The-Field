import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Conditional class names with Tailwind conflict resolution.
 *
 * `clsx` flattens conditionals; `tailwind-merge` then resolves competing
 * utilities so a caller-supplied `className` reliably wins over a component's
 * own default. Without the merge step, `<Button className="px-8">` would
 * produce `px-4 px-8` and the outcome would depend on stylesheet order.
 *
 * ── WHY THE MERGE MUST BE CONFIGURED ─────────────────────────────────────────
 * tailwind-merge decides which classes conflict from a built-in model of
 * Tailwind's DEFAULT theme. Our theme adds custom scale keys, and `text-*` is
 * the dangerous prefix because two different properties share it: text colour
 * (`text-white`) and font size (`text-body-sm`).
 *
 * Left unconfigured, tailwind-merge cannot tell that `body-sm` is a font size,
 * assumes `text-body-sm` is a colour, decides it conflicts with `text-white`,
 * and drops the earlier one:
 *
 *   twMerge('bg-brand-700 text-white', 'text-body-sm')
 *     → 'bg-brand-700 text-body-sm'          ← text-white silently gone
 *
 * That is exactly how every primary button on the site ended up rendering
 * near-black text on dark green — a 3.56:1 contrast ratio against the 4.5:1
 * WCAG AA requirement (Doc 03 NFR-ACC-004). Nothing else catches it: the
 * classes are all present in the source, TypeScript is satisfied, and the
 * markup looks correct. Only measuring painted colour reveals it.
 *
 * Registering the custom scales below makes the classification correct, so this
 * class of failure cannot recur as more components are added.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      /** tailwind.config.ts → theme.extend.fontSize */
      'font-size': [
        {
          text: [
            'body-sm',
            'body',
            'body-lg',
            'heading-sm',
            'heading',
            'heading-lg',
            'display',
            'display-lg',
          ],
        },
      ],
      /** theme.extend.borderRadius */
      rounded: [{ rounded: ['card', 'control', 'pill'] }],
      /** theme.extend.boxShadow */
      shadow: [{ shadow: ['card', 'raised', 'overlay'] }],
      /** theme.extend.maxWidth */
      'max-w': [{ 'max-w': ['content', 'prose'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
