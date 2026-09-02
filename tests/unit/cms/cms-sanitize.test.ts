import { describe, expect, it } from 'vitest'
import { cmsHtmlToPlainText, sanitizeCmsHtml } from '@/lib/cms-sanitize'

/**
 * CMS rich-text sanitisation (Doc 22 §10.6, Doc 09 §9, Doc 13 T-006).
 *
 * The threat is stored XSS: an administrator account is compromised, or a
 * future admin UI accepts pasted HTML, and the payload is then served to every
 * customer who opens the About page. Sanitising at WRITE time means the stored
 * value is already safe and no future reader has to remember to clean it.
 */

describe('sanitizeCmsHtml', () => {
  it('keeps the documented formatting tags', () => {
    const input = '<p>Hello <strong>world</strong> and <em>friends</em></p>'
    expect(sanitizeCmsHtml(input)).toBe(input)
  })

  it('keeps headings and lists', () => {
    const input = '<h2>Facilities</h2><ul><li>Covered courts</li></ul>'
    expect(sanitizeCmsHtml(input)).toBe(input)
  })

  it('strips a script tag and its contents', () => {
    const output = sanitizeCmsHtml('<p>Safe</p><script>alert(1)</script>')
    expect(output).toContain('Safe')
    expect(output).not.toContain('script')
    // The source text must not survive as visible page copy either.
    expect(output).not.toContain('alert(1)')
  })

  it('strips an inline event handler', () => {
    const output = sanitizeCmsHtml('<p onclick="steal()">Text</p>')
    expect(output).not.toContain('onclick')
    expect(output).toContain('Text')
  })

  it('strips an img with an onerror payload', () => {
    // `img` is not in the allowed tag list, so the whole element goes.
    const output = sanitizeCmsHtml('<img src=x onerror="alert(1)">')
    expect(output).not.toContain('onerror')
    expect(output).not.toContain('<img')
  })

  it('removes a javascript: href', () => {
    const output = sanitizeCmsHtml('<a href="javascript:alert(1)">Click</a>')
    expect(output).not.toContain('javascript:')
    expect(output).toContain('Click')
  })

  it('removes a data: href', () => {
    // A data: URI in an href executes in some browsers.
    const output = sanitizeCmsHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">Click</a>')
    expect(output).not.toContain('data:')
  })

  it('removes an http: href, keeping only https', () => {
    const output = sanitizeCmsHtml('<a href="http://insecure.example">Link</a>')
    expect(output).not.toContain('http://insecure.example')
  })

  it('keeps an https href and hardens the link', () => {
    const output = sanitizeCmsHtml('<a href="https://example.test">Link</a>')
    expect(output).toContain('https://example.test')
    // An outbound link opened in a new tab must not hand over window.opener.
    expect(output).toContain('rel="noopener noreferrer"')
    expect(output).toContain('target="_blank"')
  })

  it('allows a mailto link', () => {
    expect(sanitizeCmsHtml('<a href="mailto:a@example.test">Mail</a>')).toContain('mailto:')
  })

  it('strips an iframe', () => {
    const output = sanitizeCmsHtml('<iframe src="https://evil.example"></iframe>')
    expect(output).not.toContain('iframe')
  })

  it('strips a style tag and its contents', () => {
    const output = sanitizeCmsHtml('<style>body{display:none}</style><p>Text</p>')
    expect(output).not.toContain('display:none')
    expect(output).toContain('Text')
  })

  it('strips svg, the one image type that can carry script', () => {
    const output = sanitizeCmsHtml('<svg><script>alert(1)</script></svg>')
    expect(output).not.toContain('svg')
    expect(output).not.toContain('alert(1)')
  })

  it('is idempotent', () => {
    // Sanitising an already-sanitised value must not change it, or repeated
    // saves would progressively mangle the stored content.
    const once = sanitizeCmsHtml('<p>Hi <a href="https://example.test">there</a></p>')
    expect(sanitizeCmsHtml(once)).toBe(once)
  })

  it('handles an empty string', () => {
    expect(sanitizeCmsHtml('')).toBe('')
  })
})

describe('cmsHtmlToPlainText', () => {
  it('reduces markup to text', () => {
    expect(cmsHtmlToPlainText('<p>Hello <strong>world</strong></p>')).toBe('Hello world')
  })

  it('does not reveal stripped script content', () => {
    // Stripping tags after sanitising, not before, is what prevents this.
    expect(cmsHtmlToPlainText('<script>alert(1)</script><p>Safe</p>')).toBe('Safe')
  })

  it('collapses whitespace', () => {
    expect(cmsHtmlToPlainText('<p>a</p>\n\n   <p>b</p>')).toBe('a b')
  })
})
