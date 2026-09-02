/**
 * The public navigation map (Doc 22 M2-T04).
 *
 * One list, consumed by the desktop header, the mobile menu and the footer, so
 * the three can never disagree about what the site contains. `labelKey` points
 * at `messages/*.json` — no navigation label is written in JSX (Doc 23
 * REL-M2-T01).
 *
 * `/book` is deliberately ABSENT. The booking flow is Milestone 3 (Doc 24 §N);
 * linking to a route that does not exist would be a broken navigation item.
 * The "Book now" call to action is handled separately by `bookingCta` below so
 * that adding the route in M3 is a one-line change here.
 */

export interface NavItem {
  href: string
  labelKey: string
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { href: '/', labelKey: 'nav.home' },
  { href: '/courts', labelKey: 'nav.courts' },
  { href: '/pricing', labelKey: 'nav.pricing' },
  { href: '/gallery', labelKey: 'nav.gallery' },
  { href: '/faq', labelKey: 'nav.faq' },
  { href: '/contact', labelKey: 'nav.contact' },
] as const

/** Secondary destinations, shown in the mobile menu and the footer. */
export const ACCOUNT_NAV: readonly NavItem[] = [
  { href: '/booking-status', labelKey: 'nav.bookingStatus' },
  { href: '/signin', labelKey: 'nav.signIn' },
] as const

/**
 * Where the primary call to action points at this milestone.
 *
 * Until the booking flow exists (Milestone 3), "Book now" takes the customer to
 * the courts page — the real first step of choosing a court — rather than to a
 * 404 or a dead button.
 */
export const BOOKING_CTA_HREF = '/courts'
