'use client'

import { useEffect, useRef, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { Link, usePathname } from '@/i18n/navigation'
import { buttonStyles } from '@/components/ui/button'
import { cn } from '@/lib/ui/cn'

/**
 * Mobile navigation (Doc 22 M2-T04, Doc 03 NFR-ACC-002).
 *
 * ── WHY A PANEL AND NOT A DIALOG ─────────────────────────────────────────────
 * The menu is a disclosure, not a modal: it does not trap focus and does not
 * make the rest of the page inert. `aria-expanded` and `aria-controls` on the
 * toggle describe exactly that relationship, and a screen reader announces the
 * state change without any extra ARIA.
 *
 * ── WHAT MAKES IT ACCESSIBLE ─────────────────────────────────────────────────
 *  - the toggle is a real `<button>` with a text accessible name (the icon is
 *    decorative and hidden)
 *  - the panel is removed from the accessibility tree when closed, so its links
 *    are not reachable by tab or by a screen-reader rotor while hidden
 *  - Escape closes it and returns focus to the toggle
 *  - navigating closes it, so the panel never covers the page it opened
 *
 * The panel is in normal document flow below the header rather than a fixed
 * overlay, which is what keeps it free of horizontal overflow at 390px.
 */

export interface MobileNavLink {
  href: string
  label: string
}

export function MobileNav({
  links,
  ctaHref,
  ctaLabel,
  openLabel,
  closeLabel,
  menuLabel,
  languageSwitcher,
}: {
  links: readonly MobileNavLink[]
  ctaHref: string
  ctaLabel: string
  openLabel: string
  closeLabel: string
  menuLabel: string
  languageSwitcher: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const pathname = usePathname()

  // Close on navigation. Without this the panel stays open over the new page,
  // because a client-side route change does not remount this component.
  useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!isOpen) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      // Focus must go somewhere predictable, or it falls back to <body> and the
      // keyboard user loses their place entirely.
      toggleRef.current?.focus()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen])

  return (
    <div className="lg:hidden">
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls="mobile-nav-panel"
        className={cn(buttonStyles({ variant: 'ghost', size: 'sm' }), 'px-3')}
      >
        {isOpen ? <X aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}
        <span className="sr-only">{isOpen ? closeLabel : openLabel}</span>
      </button>

      {/*
        `hidden` (the HTML attribute) rather than a CSS class: it removes the
        panel from the accessibility tree and from the tab order in every
        browser, with no reliance on a stylesheet having loaded.
      */}
      <div
        id="mobile-nav-panel"
        hidden={!isOpen}
        className="absolute inset-x-0 top-full z-40 border-b border-line bg-canvas shadow-overlay"
      >
        <nav aria-label={menuLabel} className="mx-auto w-full max-w-content px-4 py-4 sm:px-6">
          <ul className="flex flex-col gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex min-h-touch items-center rounded-control px-3 text-body font-medium text-ink-800 hover:bg-ink-50"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
            <Link href={ctaHref} className={buttonStyles({ fullWidth: true })}>
              {ctaLabel}
            </Link>
            {languageSwitcher}
          </div>
        </nav>
      </div>
    </div>
  )
}
