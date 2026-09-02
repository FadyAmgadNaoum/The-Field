import type { Metadata, Viewport } from 'next'
import '../globals.css'

/**
 * Administrator root layout.
 *
 * ── WHY A SECOND ROOT LAYOUT ─────────────────────────────────────────────────
 * The public site is bilingual with an RTL Arabic mode, so its `<html>` element
 * carries a per-request `lang` and `dir` (see `src/app/[locale]/layout.tsx`).
 * The administrator dashboard is English-only in V1 — its audience is venue
 * staff and an Arabic admin UI is a documented future enhancement, not a V1
 * requirement (Doc 23 REL-M2-T01).
 *
 * Those are two different documents, so there is no `src/app/layout.tsx` and
 * each subtree owns its own. This layout is deliberately unlocalised: it never
 * loads a message catalogue and never imports the public shell.
 *
 * It performs NO authentication. The dashboard guard lives in
 * `src/app/admin/(dashboard)/layout.tsx` so that `/admin/login` and
 * `/admin/change-password` stay reachable to an administrator who cannot yet
 * use the dashboard (Doc 22 §11.2).
 */

export const metadata: Metadata = {
  title: 'The Field — Administration',
  // The dashboard must never be indexed, on any environment.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body className="min-h-screen bg-white font-sans text-ink-900 antialiased">{children}</body>
    </html>
  )
}
