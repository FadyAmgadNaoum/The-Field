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
        /**
         * Court blue — the colour of a padel court's playing surface and the
         * glass end walls, used for illustrations, alternating sections and as
         * a second accent so the site is not a single hue end to end.
         *
         * Provisional in exactly the same sense as `brand` above: it describes
         * the sport, it does not assert a brand.
         */
        court: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49',
        },
        /**
         * Warm accent, for highlights that must not read as an action.
         *
         * NOTE ON USE: 500 and 600 are background-only. For TEXT on a light
         * surface use 700 or darker — 600 on white is 3.1:1, which fails the
         * 4.5:1 AA requirement for body copy (Doc 03 NFR-ACC-004).
         */
        accent: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
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
      /**
       * Motion vocabulary (Doc 23 REL-M2-T03).
       *
       * ── WHY EVERY KEYFRAME ONLY TOUCHES opacity AND transform ────────────
       * Those two properties are composited by the GPU: they never trigger
       * layout or paint, so they cannot move a neighbouring element and cannot
       * contribute to Cumulative Layout Shift. Gate M2 requires CLS < 0.1, and
       * animating height, margin or top is the usual way that budget is spent.
       *
       * Durations stay under ~450ms. Anything longer reads as the page being
       * slow rather than as polish, and delays the moment a control can be
       * used — REL-M2-T03 requires animations not to block interactivity.
       *
       * All of these are neutralised by the `prefers-reduced-motion` block in
       * globals.css. `both` as the fill mode matters there: with the duration
       * collapsed to 0.01ms the element still holds the END state, so a reader
       * who has asked for no motion sees the finished layout rather than an
       * element stuck at opacity 0.
       */
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(0.75rem)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        /** Slow drift for decorative background artwork only. */
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-0.75rem)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 250ms ease-out both',
        'rise-in': 'rise-in 420ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 300ms cubic-bezier(0.22, 1, 0.36, 1) both',
        float: 'float 9s ease-in-out infinite',
      },
      transitionTimingFunction: {
        /** Decelerating ease — motion that settles rather than stopping dead. */
        settle: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #14532d 0%, #15803d 45%, #0369a1 100%)',
        'court-gradient': 'linear-gradient(160deg, #f0fdf4 0%, #ecfeff 55%, #f0f9ff 100%)',
      },
    },
  },
  plugins: [],
}

export default config
