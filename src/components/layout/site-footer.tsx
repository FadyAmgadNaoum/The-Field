import { ExternalLink, Mail, MapPin, Phone } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Container } from '@/components/ui/layout'
import { SOCIAL_PLATFORM_LABELS, isSocialPlatform, type SocialLink } from '@/modules/cms/cms.types'
import { ACCOUNT_NAV, PRIMARY_NAV } from './nav-items'

/**
 * Public site footer (Doc 22 M2-T04).
 *
 * ── NOTHING IS INVENTED ──────────────────────────────────────────────────────
 * Phone, email, address and social links come from the CMS and the venue row.
 * All of them are unset until the owner supplies them (Doc 22 §10.2, Doc 24
 * §D.4). A block whose value is absent is NOT rendered — no placeholder number,
 * no "info@example.com", no dead social icon. When nothing is configured the
 * column says so plainly instead (Doc 22 §10.5).
 */
export async function SiteFooter({
  venueName,
  tagline,
  contact,
  socialLinks,
}: {
  venueName: string
  tagline: string | null
  contact: { phone: string | null; email: string | null; address: string | null }
  socialLinks: readonly SocialLink[]
}) {
  const t = await getTranslations()
  const hasContact = Boolean(contact.phone || contact.email || contact.address)

  return (
    <footer className="mt-auto border-t border-line bg-subtle">
      <Container className="py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <p className="text-heading-sm font-semibold text-ink-900">{venueName}</p>
            {tagline ? (
              <p className="mt-2 max-w-prose text-body-sm text-ink-600">{tagline}</p>
            ) : null}
          </div>

          <nav aria-labelledby="footer-links-heading">
            <h2 id="footer-links-heading" className="text-body-sm font-semibold text-ink-900">
              {t('footer.linksHeading')}
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {[...PRIMARY_NAV, ...ACCOUNT_NAV].map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="inline-flex min-h-touch items-center text-body-sm text-ink-600 hover:text-ink-900 hover:underline"
                  >
                    {t(item.labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="text-body-sm font-semibold text-ink-900">
              {t('footer.contactHeading')}
            </h2>

            {hasContact ? (
              <ul className="mt-3 flex flex-col gap-2 text-body-sm text-ink-600">
                {contact.phone ? (
                  <li className="flex items-start gap-2">
                    <Phone aria-hidden className="mt-1 h-4 w-4 shrink-0" />
                    {/*
                      `dir="ltr"` on the number: a phone number is a left-to-right
                      sequence even inside an RTL paragraph, and without this the
                      leading digits render in the wrong order in Arabic.
                    */}
                    <a
                      href={`tel:${contact.phone}`}
                      dir="ltr"
                      className="inline-flex min-h-touch items-center hover:underline"
                    >
                      {contact.phone}
                    </a>
                  </li>
                ) : null}
                {contact.email ? (
                  <li className="flex items-start gap-2">
                    <Mail aria-hidden className="mt-1 h-4 w-4 shrink-0" />
                    <a
                      href={`mailto:${contact.email}`}
                      dir="ltr"
                      className="inline-flex min-h-touch items-center break-all hover:underline"
                    >
                      {contact.email}
                    </a>
                  </li>
                ) : null}
                {contact.address ? (
                  <li className="flex items-start gap-2">
                    <MapPin aria-hidden className="mt-1 h-4 w-4 shrink-0" />
                    <span className="whitespace-pre-line">{contact.address}</span>
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="mt-3 text-body-sm text-ink-500">{t('footer.contactPending')}</p>
            )}

            {socialLinks.length > 0 ? (
              <>
                <h2 className="mt-6 text-body-sm font-semibold text-ink-900">
                  {t('footer.followHeading')}
                </h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {socialLinks.map((link) => (
                    <li key={link.id}>
                      <a
                        href={link.url}
                        target="_blank"
                        // An outbound link opened in a new tab must not hand the
                        // destination a reference to our window.
                        rel="noopener noreferrer"
                        className="inline-flex min-h-touch items-center gap-2 text-body-sm text-ink-600 hover:text-ink-900 hover:underline"
                      >
                        <ExternalLink aria-hidden className="h-4 w-4 shrink-0" />
                        {/* The platform name is text, never an icon alone. */}
                        {isSocialPlatform(link.platform)
                          ? SOCIAL_PLATFORM_LABELS[link.platform]
                          : link.platform}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>

        <p className="mt-10 border-t border-line pt-6 text-body-sm text-ink-500">
          © {new Date().getFullYear()} {venueName}. {t('footer.rights')}
        </p>
      </Container>
    </footer>
  )
}
