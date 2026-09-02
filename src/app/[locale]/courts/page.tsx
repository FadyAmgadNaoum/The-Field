import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { EmptyState } from '@/components/ui/feedback'
import { Container, PageHeader, Section } from '@/components/ui/layout'
import { CourtCard } from '@/components/public/court-card'
import { venueConfig } from '@/lib/config'
import { toLocale } from '@/i18n/config'
import * as courtsService from '@/modules/courts/courts.service'

/**
 * Public courts page (Doc 22 M2-T07).
 *
 * ── WHY force-dynamic ────────────────────────────────────────────────────────
 * M2-T07's acceptance criterion is that a court created in the admin dashboard
 * appears here immediately, and that a court with `is_active = false` never
 * does. Static generation would serve a stale list until the next build, so the
 * page is rendered per request; the courts service still caches the query for
 * 60 seconds behind a tag that Milestone 5's court editor invalidates on save.
 *
 * The "active only" filter lives in the courts repository, not here, so it
 * cannot be forgotten by a future caller.
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: toLocale(params.locale), namespace: 'courts' })
  return { title: t('title'), description: t('subtitle') }
}

export default async function CourtsPage({ params }: { params: { locale: string } }) {
  setRequestLocale(toLocale(params.locale))

  const t = await getTranslations('courts')
  const courts = await courtsService.getActiveCourts(venueConfig.id)

  return (
    <Container>
      <Section>
        <PageHeader title={t('title')} description={t('subtitle')} />

        {courts.length > 0 ? (
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {courts.map((court) => (
              <CourtCard key={court.id} court={court} />
            ))}
          </ul>
        ) : (
          <div className="mt-10">
            {/*
              Doc 22 §10.5: an empty courts table is an expected state while the
              venue is being set up, not an error. It gets a plain explanation
              rather than a blank page.
            */}
            <EmptyState title={t('empty')} description={t('emptyBody')} />
          </div>
        )}
      </Section>
    </Container>
  )
}
