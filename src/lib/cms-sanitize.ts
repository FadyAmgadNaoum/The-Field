import sanitizeHtml from 'sanitize-html'

/**
 * HTML sanitisation for CMS rich text (Doc 22 §10.6, Doc 09 §9, Doc 13 T-006).
 *
 * ── WHERE THIS RUNS ──────────────────────────────────────────────────────────
 * At WRITE time, in the CMS service, before the value reaches the database.
 * Sanitising on read would mean the database holds hostile markup and every
 * future reader has to remember to clean it. Sanitising on write means the
 * stored value is already safe, and any consumer added later inherits that.
 *
 * The public site additionally renders the result as a React text node, so it
 * is escaped a second time — this function is not the only line of defence, but
 * it is the one that makes the stored data trustworthy.
 */

/** Doc 22 §10.6 — a deliberately small set. Anything absent is stripped. */
const ALLOWED_TAGS = ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'br']

export function sanitizeCmsHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    // No `http:`, no `javascript:`, no `data:`. A `data:` URI in an href is a
    // script-execution vector in some browsers, so the scheme allow-list is
    // the control rather than a URL pattern.
    allowedSchemes: ['https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href'],
    // Strip the content of anything removed, so a stripped <script> does not
    // leave its source text behind as visible page copy.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
    transformTags: {
      // An outbound link that opens in a new tab without `noopener` hands the
      // destination a reference to our window.
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' },
      }),
    },
  })
}

/**
 * Reduce sanitised rich text to plain text.
 *
 * Used for meta descriptions and card summaries, where markup would be shown
 * literally. Runs the sanitiser first so that stripping tags cannot reveal
 * anything the sanitiser would have removed.
 */
export function cmsHtmlToPlainText(input: string): string {
  return sanitizeHtml(sanitizeCmsHtml(input), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim()
}
