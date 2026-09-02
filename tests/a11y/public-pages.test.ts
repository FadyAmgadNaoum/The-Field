import { JSDOM } from 'jsdom'
import { beforeAll, describe, expect, it } from 'vitest'
import { LOCALES } from '@/i18n/config'

/**
 * Accessibility audit of the public website (Doc 22 M2-T11, Doc 23 Gate M2,
 * Doc 03 NFR-ACC-001…006).
 *
 * ── HOW THIS RUNS ────────────────────────────────────────────────────────────
 * Every page is fetched from a RUNNING application and audited with axe-core in
 * jsdom. Auditing the real server response rather than a component in isolation
 * is what makes the result meaningful: it exercises the actual document — the
 * `lang` and `dir` attributes, the landmark structure, the skip link, the
 * heading order across layout and page together — which a component-level test
 * cannot see.
 *
 * Prerequisite, in the same spirit as the database for the integration suite:
 *
 *   npm run dev          (or npm run start against a production build)
 *   npm run test:a11y
 *
 * The suite FAILS rather than skipping when nothing is listening, so a green
 * run always means the pages were genuinely audited.
 *
 * ── WHAT jsdom CAN AND CANNOT CHECK ──────────────────────────────────────────
 * jsdom has no layout engine, so rules that need computed geometry or painted
 * colour — `color-contrast` and target size — cannot run here and axe reports
 * them as "incomplete" rather than passing. Those are verified separately in a
 * real browser and reported in the Milestone 2 report. Everything else — labels,
 * alternative text, ARIA validity, roles, names, document structure, duplicate
 * ids — is fully checked.
 */

const BASE_URL = process.env.A11Y_BASE_URL ?? 'http://localhost:3000'

/** Every public page delivered by Milestone 2, in both locales. */
const PATHS = [
  '',
  '/courts',
  '/pricing',
  '/about',
  '/faq',
  '/gallery',
  '/contact',
  '/signin',
  '/booking-status',
] as const

/** WCAG 2.1 A and AA, which is the documented target (Doc 03 NFR-ACC-001). */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

interface AxeViolation {
  id: string
  impact: string | null
  help: string
  nodes: { html: string; failureSummary?: string }[]
}

async function fetchPage(path: string): Promise<string> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { accept: 'text/html' },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`GET ${path} returned ${response.status}`)
  }
  return response.text()
}

async function auditHtml(html: string, url: string): Promise<AxeViolation[]> {
  const dom = new JSDOM(html, {
    url,
    pretendToBeVisual: true,
    // Scripts are not executed. The audit is of the SERVER-RENDERED document,
    // which is what a visitor receives before hydration and what a crawler and
    // a text browser see. It is also the state that must already be accessible.
    runScripts: 'outside-only',
  })

  const axeSource = (await import('axe-core')).default
  const { window } = dom

  // axe-core ships its own bundle as `.source`. It is evaluated INSIDE the
  // jsdom window so that it audits that document with that window's globals —
  // importing the module into this process would have it inspect nothing.
  // The source is a full script, so it is evaluated as-is; wrapping it in
  // parentheses would make it an expression and fail to parse.
  window.eval(axeSource.source)

  const axe = (window as unknown as { axe: typeof axeSource }).axe
  const results = await axe.run(window.document, {
    runOnly: { type: 'tag', values: AXE_TAGS },
    resultTypes: ['violations'],
  })

  dom.window.close()

  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? null,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({
      html: node.html,
      failureSummary: node.failureSummary,
    })),
  }))
}

function describeViolations(path: string, violations: AxeViolation[]): string {
  return violations
    .map(
      (violation) =>
        `\n[${violation.impact ?? 'unknown'}] ${violation.id} on ${path}: ${violation.help}\n` +
        violation.nodes
          .slice(0, 3)
          .map((node) => `    ${node.html}\n    ${node.failureSummary ?? ''}`)
          .join('\n'),
    )
    .join('\n')
}

beforeAll(async () => {
  try {
    await fetch(`${BASE_URL}/api/health/live`)
  } catch {
    throw new Error(
      `No application is listening on ${BASE_URL}.\n` +
        'Start it first:  npm run dev\n' +
        'Then run:        npm run test:a11y\n' +
        'Override the origin with A11Y_BASE_URL.',
    )
  }
}, 30_000)

/**
 * Canary.
 *
 * A harness that fails to load axe reports zero violations for every page —
 * indistinguishable from a perfect result, and exactly how an accessibility
 * suite quietly stops testing anything. This audits a document with three
 * deliberate, unmistakable faults first. If it does not fail, nothing below it
 * means anything.
 */
describe('audit harness', () => {
  it('detects violations in a deliberately broken document', async () => {
    const broken = `<!doctype html><html><body>
      <img src="x.png">
      <input type="text">
      <a href="#"></a>
    </body></html>`

    const violations = await auditHtml(broken, BASE_URL)
    const ids = violations.map((violation) => violation.id)

    expect(ids).toContain('image-alt')
    expect(ids).toContain('html-has-lang')
    expect(violations.length).toBeGreaterThanOrEqual(3)
  })
})

describe.each(LOCALES)('locale %s', (locale) => {
  describe.each(PATHS)('page %s', (path) => {
    const url = `${BASE_URL}/${locale}${path}`

    it('has no accessibility violations', async () => {
      const html = await fetchPage(`/${locale}${path}`)
      const violations = await auditHtml(html, url)

      expect(violations, describeViolations(`/${locale}${path}`, violations)).toEqual([])
    }, 30_000)
  })
})

describe.each(LOCALES)('document structure — %s', (locale) => {
  let document: Document

  beforeAll(async () => {
    const html = await fetchPage(`/${locale}`)
    document = new JSDOM(html).window.document
  }, 30_000)

  it('declares the locale on the html element', () => {
    // Without this a screen reader reads Arabic content with an English voice.
    expect(document.documentElement.getAttribute('lang')).toBe(locale)
  })

  it('declares the correct text direction', () => {
    // Gate M2 checks for dir="rtl" in Arabic specifically.
    expect(document.documentElement.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr')
  })

  it('has exactly one h1', () => {
    expect(document.querySelectorAll('h1')).toHaveLength(1)
  })

  it('has one main landmark with a matching skip-link target', () => {
    const main = document.querySelectorAll('main')
    expect(main).toHaveLength(1)

    const skipLink = document.querySelector('a.skip-link')
    expect(skipLink).not.toBeNull()

    const target = skipLink?.getAttribute('href')?.replace('#', '')
    expect(target).toBeTruthy()
    expect(document.getElementById(target as string)).not.toBeNull()
  })

  it('makes the skip link the first focusable element', () => {
    // A skip link that is not first does not save anyone any keystrokes.
    const focusable = document.querySelectorAll('a[href], button, input, select, textarea')
    expect(focusable[0]?.className).toContain('skip-link')
  })

  it('has a banner and a contentinfo landmark', () => {
    expect(document.querySelector('header')).not.toBeNull()
    expect(document.querySelector('footer')).not.toBeNull()
  })

  it('gives every navigation landmark a distinguishing name', () => {
    // Several <nav> elements without labels are announced identically.
    const navs = [...document.querySelectorAll('nav')]
    expect(navs.length).toBeGreaterThan(0)

    for (const nav of navs) {
      const hasName = nav.hasAttribute('aria-label') || nav.hasAttribute('aria-labelledby')
      expect(hasName, `nav without an accessible name: ${nav.outerHTML.slice(0, 120)}`).toBe(true)
    }
  })

  it('gives every image an alt attribute', () => {
    // Doc 03 NFR-ACC-003. An empty alt is correct for a decorative image; a
    // MISSING alt is never correct.
    for (const image of document.querySelectorAll('img')) {
      expect(image.hasAttribute('alt'), `img without alt: ${image.outerHTML.slice(0, 120)}`).toBe(
        true,
      )
    }
  })

  it('gives every button an accessible name', () => {
    // An icon-only control needs visually hidden text; the icon itself is
    // aria-hidden because it duplicates rather than adds meaning.
    for (const button of document.querySelectorAll('button')) {
      const name =
        button.textContent?.trim() ||
        button.getAttribute('aria-label') ||
        button.getAttribute('title')
      expect(name, `button without a name: ${button.outerHTML.slice(0, 160)}`).toBeTruthy()
    }
  })

  it('gives every link an accessible name and a destination', () => {
    for (const link of document.querySelectorAll('a')) {
      const name = link.textContent?.trim() || link.getAttribute('aria-label')
      expect(name, `link without a name: ${link.outerHTML.slice(0, 160)}`).toBeTruthy()
      expect(link.getAttribute('href')).toBeTruthy()
    }
  })

  it('adds rel="noopener noreferrer" to every link opening in a new tab', () => {
    for (const link of document.querySelectorAll('a[target="_blank"]')) {
      const rel = link.getAttribute('rel') ?? ''
      expect(rel).toContain('noopener')
      expect(rel).toContain('noreferrer')
    }
  })

  it('uses no duplicate element ids', () => {
    // Duplicate ids silently break `for`, `aria-labelledby` and `aria-controls`.
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('form accessibility', () => {
  it('labels every control on the sign-in page', async () => {
    const html = await fetchPage('/en/signin')
    const { document } = new JSDOM(html).window

    const controls = [...document.querySelectorAll('input, textarea, select')].filter(
      (control) => control.getAttribute('type') !== 'hidden',
    )
    expect(controls.length).toBeGreaterThan(0)

    for (const control of controls) {
      const id = control.getAttribute('id')
      const labelled =
        (id && document.querySelector(`label[for="${id}"]`)) ||
        control.getAttribute('aria-label') ||
        control.getAttribute('aria-labelledby')

      expect(labelled, `control without a label: ${control.outerHTML.slice(0, 160)}`).toBeTruthy()
    }
  }, 30_000)

  it('labels every control on the booking status page for a signed-out visitor', async () => {
    // Signed out the page shows a prompt rather than the form; this asserts the
    // page is still well-formed in that state.
    const html = await fetchPage('/en/booking-status')
    const { document } = new JSDOM(html).window

    for (const control of document.querySelectorAll('input, textarea, select')) {
      const id = control.getAttribute('id')
      const labelled =
        (id && document.querySelector(`label[for="${id}"]`)) ||
        control.getAttribute('aria-label') ||
        control.getAttribute('aria-labelledby')

      expect(labelled).toBeTruthy()
    }
  }, 30_000)
})
