import { MessageCircle } from 'lucide-react'

/**
 * Floating WhatsApp contact action (Doc 22 M2-T04).
 *
 * ── HIDDEN WHEN UNCONFIGURED ─────────────────────────────────────────────────
 * M2-T04's acceptance criterion is explicit: "WhatsApp button hidden when number
 * not configured". Not greyed out, not linking to a placeholder — absent. The
 * number is an owner-supplied CMS value (`venue.whatsapp`) and no default
 * exists anywhere in code, seed or fixtures (Doc 22 §10.2, Doc 24 §M item 11).
 *
 * The caller passes null when the setting is empty and this renders nothing.
 */
export function WhatsAppButton({ number, label }: { number: string | null; label: string }) {
  if (!number) return null

  // wa.me takes digits only. The stored value is validated as +20……… by the CMS
  // (Doc 09 §7), so stripping non-digits is a format conversion, not a
  // correction of unvalidated input.
  const digits = number.replace(/\D/g, '')
  if (digits === '') return null

  return (
    <a
      href={`https://wa.me/${digits}`}
      target="_blank"
      rel="noopener noreferrer"
      // `fixed` with logical inset so it sits bottom-start in LTR and
      // bottom-end mirrored in RTL, clear of the page content either way.
      className="fixed bottom-5 end-5 z-30 inline-flex h-touch w-touch items-center justify-center rounded-pill bg-brand-700 text-white shadow-overlay transition-colors hover:bg-brand-800"
    >
      <MessageCircle aria-hidden className="h-6 w-6" />
      {/* The icon alone is not an accessible name (Doc 03 NFR-ACC-003). */}
      <span className="sr-only">{label}</span>
    </a>
  )
}
