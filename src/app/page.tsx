/**
 * Placeholder root page.
 *
 * The public website — home, courts, pricing, gallery, FAQ, contact and the
 * booking flow — is built in Milestone 2 and Milestone 3. Nothing here is
 * customer-facing content, and no business value is invented.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">The Field</h1>
      <p className="text-slate-600">
        Application foundation is in place. The public website is built in Milestone 2.
      </p>
      <dl className="mt-4 grid gap-2 text-sm text-slate-500">
        <div className="flex gap-2">
          <dt className="font-medium text-slate-700">Health:</dt>
          <dd>
            <code>/api/health/live</code>, <code>/api/health/ready</code>
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium text-slate-700">API:</dt>
          <dd>
            <code>/api/v1</code>
          </dd>
        </div>
      </dl>
    </main>
  )
}
