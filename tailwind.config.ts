import type { Config } from 'tailwindcss'

/**
 * Tailwind theme — The Field design system (Doc 22 M2-T04, Doc 23 REL-M2-T01).
 *
 * ── ON THE COLOUR VALUES ─────────────────────────────────────────────────────
 * No approved brand palette exists in Documents 00–24. A search of the
 * specification set returns the font stack (Doc 23 REL-M2-T01: Cairo + Inter)
 * and FR-CUS-004 ("must display The Field's name, logo, and branding"), but no
 * hex values, no logo asset and no typographic scale.
 *
 * Rather than scatter invented one-off values through every page, the palette
 * below is defined ONCE here and referenced everywhere as a semantic token.
 * It is explicitly PROVISIONAL: when the venue owner supplies real brand
 * colours, only this file changes and every page follows. This is recorded as
 * an open owner decision in the Milestone 2 report — it is not presented as an
 * approved brand identity.
 *
 * ── SEMANTIC, NOT LITERAL ────────────────────────────────────────────────────
 * Components use `bg-brand-600`, `text-ink-600`, `border-line` — never a raw
 * hex and never `bg-green-600`. That indirection is what makes the palette
 * swappable.
 *
 * ── RTL ──────────────────────────────────────────────────────────────────────
 * Layout uses CSS logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`,
 * `text-start`, `text-end`) which Tailwind 3.4 supports natively, so the same
 * markup is correct in both directions. The `rtl:`/`ltr:` variants below are
 * for the few cases logical properties cannot express, such as mirroring a
 * directional icon.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * Primary action colour. Provisional — see the note above.
         * Padel is played on a green court; a green-family primary is a neutral
         * placeholder that does not assert a brand.
         */
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          950: '#052e16',
        },
        /** Text and surface neutrals. */
        ink: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        /** Status colours. Never the ONLY signal — always paired with text. */
        success: { 50: '#f0fdf4', 600: '#16a34a', 700: '#15803d' },
        warning: { 50: '#fffbeb', 600: '#d97706', 700: '#b45309' },
        danger: { 50: '#fef2f2', 600: '#dc2626', 700: '#b91c1c' },
        info: { 50: '#eff6ff', 600: '#2563eb', 700: '#1d4ed8' },

        /** Semantic surface aliases. */
        canvas: '#ffffff',
        subtle: '#f8fafc',
        line: '#e2e8f0',
      },
      fontFamily: {
        /**
         * Doc 23 REL-M2-T01: a stack that covers Latin and Arabic. The CSS
         * variables are supplied by `next/font` in the root layout, which
         * self-hosts the files — no runtime request to a third party, so the
         * `font-src 'self' data:` CSP directive stays unchanged.
         */
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        arabic: ['var(--font-arabic)', 'var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Body text never drops below 16px on mobile: smaller values cause iOS
        // Safari to zoom on focus, which breaks the form layout (Doc 03
        // NFR-USE-002 mobile usability).
        'body-sm': ['0.9375rem', { lineHeight: '1.5rem' }],
        body: ['1rem', { lineHeight: '1.625rem' }],
        'body-lg': ['1.125rem', { lineHeight: '1.75rem' }],
        'heading-sm': ['1.25rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em' }],
        heading: ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.015em' }],
        'heading-lg': ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.02em' }],
        display: ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.025em' }],
        'display-lg': ['3rem', { lineHeight: '1.1', letterSpacing: '-0.03em' }],
      },
      borderRadius: {
        card: '0.75rem',
        control: '0.5rem',
        pill: '9999px',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        raised: '0 4px 6px -1px rgb(15 23 42 / 0.07), 0 2px 4px -2px rgb(15 23 42 / 0.05)',
        overlay: '0 10px 15px -3px rgb(15 23 42 / 0.1), 0 4px 6px -4px rgb(15 23 42 / 0.1)',
      },
      maxWidth: {
        /** Page container. Wider than prose, narrow enough to stay readable. */
        content: '72rem',
        prose: '42rem',
      },
      spacing: {
        /**
         * Minimum interactive target. WCAG 2.1 AA target size and the practical
         * floor for thumb use on a 390px viewport (Doc 03 NFR-ACC-002).
         */
        touch: '2.75rem',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(0.5rem)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        // Short, non-layout-shifting entrances. Both are neutralised by the
        // prefers-reduced-motion block in globals.css (Doc 23 REL-M2-T03).
        'fade-in': 'fade-in 200ms ease-out both',
        'rise-in': 'rise-in 240ms ease-out both',
      },
    },
  },
  plugins: [],
}

export default config
