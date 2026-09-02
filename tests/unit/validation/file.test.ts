import { describe, expect, it } from 'vitest'
import { UPLOAD_LIMITS, validateImageFile, validateProofFile } from '@/lib/validation/file'
import { ValidationError } from '@/lib/errors'

/**
 * Upload validation (Doc 22 §9.4–9.5, Doc 13 T-010, T-011, Doc 24 §J.1).
 *
 * Doc 24 §J.1 names "upload security (PHP-as-JPEG, SVG, 11 MB)" as a
 * non-negotiable suite. These are the unit-level versions: the type of a file
 * is decided by its magic bytes and never by a header or a filename, both of
 * which the client chooses.
 */

/** Minimal but genuine file signatures. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
  Buffer.alloc(32),
])
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32)])
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(32),
])

/**
 * A PHP web shell with a .jpg name and an image/jpeg content type — the exact
 * attack Doc 13 T-010 describes. It has no image signature.
 */
const PHP_SHELL = Buffer.from('<?php system($_GET["cmd"]); ?>')

/** SVG has no magic number and can carry script (Doc 13 T-011). */
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

const HTML = Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>')

describe('validateProofFile', () => {
  it('accepts a JPEG', async () => {
    await expect(validateProofFile(JPEG)).resolves.toMatchObject({
      mimeType: 'image/jpeg',
      extension: 'jpg',
    })
  })

  it('accepts a PNG', async () => {
    await expect(validateProofFile(PNG)).resolves.toMatchObject({ mimeType: 'image/png' })
  })

  it('accepts a PDF', async () => {
    await expect(validateProofFile(PDF)).resolves.toMatchObject({ mimeType: 'application/pdf' })
  })

  it('rejects a PHP shell regardless of what it is named', async () => {
    // The filename and Content-Type never reach this function; only bytes do.
    await expect(validateProofFile(PHP_SHELL)).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects SVG', async () => {
    await expect(validateProofFile(SVG)).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects HTML', async () => {
    await expect(validateProofFile(HTML)).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects an empty file', async () => {
    await expect(validateProofFile(Buffer.alloc(0))).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects a file over 10MB', async () => {
    // Doc 24 §J.1's "11 MB" case.
    const oversized = Buffer.concat([JPEG, Buffer.alloc(11 * 1024 * 1024)])
    await expect(validateProofFile(oversized)).rejects.toThrow(/10MB/)
  })

  it('accepts a file just under the limit', async () => {
    const justUnder = Buffer.concat([
      JPEG,
      Buffer.alloc(UPLOAD_LIMITS.proofMaxBytes - JPEG.length - 1),
    ])
    await expect(validateProofFile(justUnder)).resolves.toMatchObject({ mimeType: 'image/jpeg' })
  })

  it('does not accept WebP, which is not a documented proof format', async () => {
    // Doc 24 §H.2 fixes the proof list at JPEG, PNG and PDF.
    await expect(validateProofFile(WEBP)).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('validateImageFile', () => {
  it('accepts JPEG, PNG and WebP', async () => {
    await expect(validateImageFile(JPEG)).resolves.toMatchObject({ mimeType: 'image/jpeg' })
    await expect(validateImageFile(PNG)).resolves.toMatchObject({ mimeType: 'image/png' })
    await expect(validateImageFile(WEBP)).resolves.toMatchObject({ mimeType: 'image/webp' })
  })

  it('rejects a PDF, which is not an image', async () => {
    await expect(validateImageFile(PDF)).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects SVG', async () => {
    await expect(validateImageFile(SVG)).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects a PHP shell', async () => {
    await expect(validateImageFile(PHP_SHELL)).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects a file over 5MB', async () => {
    const oversized = Buffer.concat([JPEG, Buffer.alloc(6 * 1024 * 1024)])
    await expect(validateImageFile(oversized)).rejects.toThrow(/5MB/)
  })
})

describe('error messages', () => {
  it('never leaks the detected type of a rejected file', async () => {
    // Telling an attacker exactly what was detected helps them iterate.
    await expect(validateProofFile(PHP_SHELL)).rejects.toThrow(/JPEG, PNG or PDF/)
  })
})
