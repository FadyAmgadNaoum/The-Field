import type { Metadata, Viewport } from 'next'
import './globals.css'

/**
 * Root layout.
 *
 * `lang` and `dir` are hardcoded to English/LTR in Milestone 0. Milestone 2
 * replaces this with locale-driven values (`/en/`, `/ar/`) and switches `dir`
 * to `rtl` for Arabic — Doc 23 REL-M2-T01, Doc 24 §C.3.
 *
 * SEO metadata becomes CMS-driven in Milestone 2 (Doc 09 §3.1 `seo.*` keys).
 */

export const metadata: Metadata = {
  title: 'The Field',
  description: 'Padel court booking.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body className="min-h-screen bg-white text-slate-900 antialiased">{children}</body>
    </html>
  )
}
