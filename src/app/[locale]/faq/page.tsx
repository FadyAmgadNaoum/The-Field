import type { Metadata } from 'next'
import { ChevronDown } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { EmptyState } from '@/components/ui/feedback'
import { Container, PageHeader, Section } from '@/components/ui/layout'
import { venueConfig } from '@/lib/config'
import { toLocale } from '@/i18n/config'
import * as cms from '@/modules/cms/cms.service'

/**
 * Public FAQ page (Doc 22 M2-T06, Doc 09 §6.2).
 *
 * ── WHY <details>/<summary> AND NOT AN ARIA ACCORDION ────────────────────────
 * The native disclosure element is keyboard operable, announces its expanded
 * state, is exposed correctly to every screen reader, and works with JavaScript
 * disabled — all without a line of ARIA or a click handler. A hand-built
 * accordion would need `aria-expanded`, `aria-controls`, roving focus and a key
 * handler to reach the same place, and would ship JavaScript to do it. Doc 03
 * NFR-ACC-002 asks for keyboard operability, not for a custom widget.
 *
 * ── NO INVENTED ANSWERS ──────────────────────────────────────────────────────
 * Every question and answer comes from `cms_faqs`, which starts empty. This
 * page ships with no built-in content: several plausible FAQs (cancellation
 * policy, how long a slot is held) depend on OBD-001 and OBD-002, which are
 * unresolved owner decisions (Doc 24 §L). Writing an answer here would be
 * inventing venue policy.
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: toLocale(params.locale), namespace: 'faq' })
  return { title: t('title'), description: t('subtitle') }
}

export default async function FaqPage({ params }: { params: { locale: string } }) {
  setRequestLocale(toLocale(params.locale))

  const t = await getTranslations('faq')
  const faqs = await cms.getFaqs(venueConfig.id, true)

  return (
    <Container>
      <Section>
        <PageHeader title={t('title')} description={t('subtitle')} />

        {faqs.length === 0 ? (
          <div className="mt-10">
            <EmptyState title={t('empty')} />
          </div>
        ) : (
          <ul className="mt-10 max-w-prose divide-y divide-line rounded-card border border-line bg-canvas">
            {faqs.map((faq) => (
              <li key={faq.id}>
                <details className="group">
                  <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-body font-medium text-ink-900 marker:content-none">
                    {faq.question}
                    <ChevronDown
                      aria-hidden
                      className="h-5 w-5 shrink-0 text-ink-500 transition-transform group-open:rotate-180"
                    />
                  </summary>
                  {/* Answer text is CMS-authored and rendered as text, not markup. */}
                  <div className="px-5 pb-5 text-body-sm text-ink-600">
                    <p className="whitespace-pre-line">{faq.answer}</p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Container>
  )
}
