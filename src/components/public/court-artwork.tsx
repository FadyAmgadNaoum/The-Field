import { cn } from '@/lib/ui/cn'

/**
 * Decorative padel artwork (Doc 23 REL-M2-T03).
 *
 * ── WHY DRAWN, NOT PHOTOGRAPHED ──────────────────────────────────────────────
 * The venue has supplied no photography. Putting a stock photograph of somebody
 * else's club on The Field's own website would tell a customer something untrue
 * about the place they are about to book — the same reason there is no invented
 * phone number or price anywhere in this codebase.
 *
 * These are diagrams of the sport rather than depictions of the venue. They
 * carry no such claim, and they are replaced the moment a real photograph is
 * uploaded: `CourtCard` prefers `court_images` and only falls back here.
 *
 * ── WHY INLINE SVG ───────────────────────────────────────────────────────────
 * No network request, nothing for the CSP to allow, no layout shift while an
 * image loads, and it stays sharp at any density. The whole set costs a few
 * hundred bytes of markup and no JavaScript.
 *
 * ── ACCESSIBILITY ────────────────────────────────────────────────────────────
 * Every graphic here is decorative: the court's name and description sit beside
 * it in text. They are `aria-hidden` so a screen reader is not made to listen to
 * a description of a diagram that adds nothing (Doc 03 NFR-ACC-003).
 */

/** Court colourways, so a grid of cards is not one flat repeated block. */
export const COURT_VARIANTS = ['green', 'blue', 'teal'] as const
export type CourtVariant = (typeof COURT_VARIANTS)[number]

const VARIANT_COLOURS: Record<
  CourtVariant,
  { surface: string; surfaceAlt: string; line: string; frame: string; glass: string }
> = {
  green: {
    surface: '#166534',
    surfaceAlt: '#15803d',
    line: '#f8fafc',
    frame: '#0f3d22',
    glass: '#86efac',
  },
  blue: {
    surface: '#075985',
    surfaceAlt: '#0369a1',
    line: '#f8fafc',
    frame: '#0c4a6e',
    glass: '#7dd3fc',
  },
  teal: {
    surface: '#115e59',
    surfaceAlt: '#0f766e',
    line: '#f8fafc',
    frame: '#134e4a',
    glass: '#5eead4',
  },
}

/** Deterministic variant from a court id, so a card keeps its colour. */
export function variantForKey(key: string): CourtVariant {
  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 9973
  }
  return COURT_VARIANTS[hash % COURT_VARIANTS.length] as CourtVariant
}

/**
 * A padel court seen from above, drawn to regulation proportions.
 *
 * 20m × 10m, so the viewBox is 200 × 100 at 1 unit = 10cm. The service lines
 * sit 6.95m from each back wall and the centre service line divides the boxes —
 * the real markings, which is what makes it read as a padel court rather than a
 * tennis court.
 */
export function PadelCourtGraphic({
  variant = 'green',
  uid,
  className,
}: {
  variant?: CourtVariant
  /**
   * Namespace for this instance's `<defs>` ids.
   *
   * SVG ids share the DOCUMENT's id space, not the SVG's. Deriving them from
   * the variant alone meant two cards with the same colourway emitted the same
   * `linearGradient` id — a duplicate id, which is invalid and which makes the
   * second element's `fill="url(#…)"` resolve to the first one's gradient.
   *
   * Caller supplies something unique per instance; `CourtCard` passes the
   * court's id. The accessibility audit caught this, which is why it exists.
   */
  uid: string
  className?: string
}) {
  const c = VARIANT_COLOURS[variant]
  // Strip anything that is not id-safe; a UUID is already safe, but the prop
  // is a plain string and a future caller might pass a name.
  const id = `court-${uid.replace(/[^a-zA-Z0-9_-]/g, '')}`

  return (
    <svg
      viewBox="0 0 200 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      focusable="false"
      className={cn('h-full w-full', className)}
    >
      <defs>
        <linearGradient id={`${id}-surface`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={c.surfaceAlt} />
          <stop offset="100%" stopColor={c.surface} />
        </linearGradient>
      </defs>

      <rect width="200" height="100" fill={`url(#${id}-surface)`} />

      {/* Glass end walls, which is what distinguishes padel from tennis. */}
      <rect x="0" y="0" width="6" height="100" fill={c.glass} opacity="0.35" />
      <rect x="194" y="0" width="6" height="100" fill={c.glass} opacity="0.35" />

      <g stroke={c.line} strokeWidth="1.1" fill="none" opacity="0.9">
        {/* Court perimeter */}
        <rect x="6" y="6" width="188" height="88" />
        {/* Service lines, 6.95m from each back wall */}
        <line x1="69.5" y1="6" x2="69.5" y2="94" />
        <line x1="130.5" y1="6" x2="130.5" y2="94" />
        {/* Centre service line */}
        <line x1="69.5" y1="50" x2="130.5" y2="50" />
      </g>

      {/* Net across the middle, with its post shadows. */}
      <g>
        <rect x="98.6" y="6" width="2.8" height="88" fill={c.frame} opacity="0.85" />
        <rect x="98.6" y="6" width="2.8" height="88" fill={c.line} opacity="0.25" />
        <circle cx="100" cy="6" r="2.4" fill={c.frame} />
        <circle cx="100" cy="94" r="2.4" fill={c.frame} />
      </g>
    </svg>
  )
}

/**
 * Abstract backdrop for the hero.
 *
 * Court markings dissolved into overlapping arcs and a faint grid — it reads as
 * "sport" without pretending to be a photograph of anywhere. Sits behind the
 * headline at low opacity so the text keeps its contrast ratio.
 */
export function HeroBackdrop({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      focusable="false"
      className={cn('h-full w-full', className)}
    >
      <defs>
        <linearGradient id="hero-wash" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#14532d" />
          <stop offset="50%" stopColor="#15803d" />
          <stop offset="100%" stopColor="#0369a1" />
        </linearGradient>
        <pattern id="hero-grid" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M48 0H0V48" fill="none" stroke="#ffffff" strokeWidth="0.6" opacity="0.12" />
        </pattern>
      </defs>

      <rect width="1200" height="600" fill="url(#hero-wash)" />
      <rect width="1200" height="600" fill="url(#hero-grid)" />

      {/* Court outline, oversized and cropped, as a large graphic gesture. */}
      <g
        stroke="#ffffff"
        strokeWidth="2"
        fill="none"
        opacity="0.18"
        transform="translate(620 60) rotate(-12)"
      >
        <rect x="0" y="0" width="620" height="310" rx="4" />
        <line x1="310" y1="0" x2="310" y2="310" />
        <line x1="105" y1="0" x2="105" y2="310" />
        <line x1="515" y1="0" x2="515" y2="310" />
        <line x1="105" y1="155" x2="515" y2="155" />
      </g>

      {/* Ball arcs — motion suggested, not depicted. */}
      <g fill="none" opacity="0.2" strokeLinecap="round">
        <path d="M-40 470 C 200 330, 420 520, 700 360" stroke="#bbf7d0" strokeWidth="3" />
        <path d="M-40 540 C 260 420, 520 590, 860 430" stroke="#7dd3fc" strokeWidth="2" />
      </g>
      <circle cx="700" cy="360" r="9" fill="#dcfce7" opacity="0.55" />
    </svg>
  )
}

/**
 * Small court motif used for empty states.
 *
 * Signals "something belongs here" rather than leaving a blank panel, which is
 * what an empty region otherwise reads as — a broken page (Doc 22 §10.5).
 */
export function CourtMotif({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 60"
      aria-hidden
      focusable="false"
      className={cn('h-auto w-full', className)}
    >
      <rect x="1" y="1" width="118" height="58" rx="3" className="fill-brand-50 stroke-brand-200" />
      <g className="stroke-brand-300" strokeWidth="1" fill="none">
        <line x1="60" y1="1" x2="60" y2="59" />
        <line x1="22" y1="1" x2="22" y2="59" />
        <line x1="98" y1="1" x2="98" y2="59" />
        <line x1="22" y1="30" x2="98" y2="30" />
      </g>
      <circle cx="84" cy="20" r="3.5" className="fill-accent-400" />
    </svg>
  )
}
