import { logger } from './logger'

/**
 * Error reporting seam.
 *
 * Doc 22 M0-T11 and Doc 24 §O call for Sentry. The Sentry SDK itself is wired
 * in a later milestone; this module is the single integration point so that
 * change touches one file and no call site.
 *
 * Until then every captured error is written to the structured log, which is
 * collected on the VPS (Doc 16 §5.3). Nothing is silently swallowed.
 *
 * Call sites use `captureException` / `captureMessage` rather than importing an
 * SDK directly, exactly as Doc 23 §12.3 requires scrubbing to be centralised.
 */

export type Severity = 'warning' | 'error' | 'fatal'

export interface CaptureContext {
  requestId?: string
  /**
   * Additional diagnostic fields. These pass through the pino redaction rules,
   * so sensitive keys are censored before they reach any sink (Doc 23 §12.3).
   */
  [key: string]: unknown
}

export function captureException(error: unknown, context: CaptureContext = {}): void {
  const normalised =
    error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error')

  logger.error(
    {
      ...context,
      err: {
        name: normalised.name,
        message: normalised.message,
        stack: normalised.stack,
        code: (normalised as NodeJS.ErrnoException).code,
      },
    },
    normalised.message,
  )
}

export function captureMessage(
  message: string,
  severity: Severity = 'warning',
  context: CaptureContext = {},
): void {
  const level = severity === 'warning' ? 'warn' : severity
  logger[level](context, message)
}
