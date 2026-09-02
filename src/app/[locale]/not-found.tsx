import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonStyles } from '@/components/ui/button'
import { Container, Section } from '@/components/ui/layout'

/**
 * Not-found page for the public site.
 *
 * Rendered inside the locale layout, so it keeps the header, footer, language
 * and text direction of the page the visitor was on.
 */
export default async function NotFound() {
  const t = await getTranslations('notFound')

  return (
    <Container>
      <Section className="text-center">
        <h1 className="text-heading-lg font-semibold text-ink-900">{t('title')}</h1>
        <p className="mx-auto mt-3 max-w-prose text-body text-ink-600">{t('body')}</p>
        <div className="mt-8 flex justify-center">
          <Link href="/" className={buttonStyles()}>
            {t('cta')}
          </Link>
        </div>
      </Section>
    </Container>
  )
}
