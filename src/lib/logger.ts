import pino from 'pino'

/**
 * Structured logging (Doc 16 §5.1, Doc 22 M0-T08, Doc 23 §12.4).
 *
 * Redaction is the security control here, not a convenience. Doc 13 T-018
 * treats customer phone numbers, credentials and internal storage keys in logs
 * as an information-disclosure vulnerability, and Doc 23 §12.4 lists the fields
 * that must never appear in log output.
 *
 * Paths use wildcards so a sensitive field is redacted wherever it is nested,
 * not only at the top level.
 */

const REDACTED = '[REDACTED]'

/**
 * Fields that must never reach a log sink, in any position.
 * Doc 23 §12.4 "NEVER present in logs".
 */
export const REDACT_PATHS = [
  // Credentials and secrets
  'password',
  '*.password',
  '*.*.password',
  'passwordHash',
  '*.passwordHash',
  'password_hash',
  '*.password_hash',
  'SESSION_SECRET',
  '*.SESSION_SECRET',
  'sessionSecret',
  '*.sessionSecret',
  'DATABASE_URL',
  '*.DATABASE_URL',
  'S3_SECRET_ACCESS_KEY',
  '*.S3_SECRET_ACCESS_KEY',
  'GOOGLE_CLIENT_SECRET',
  '*.GOOGLE_CLIENT_SECRET',

  // Customer personal data (Doc 03 NFR-COMP-001, Doc 13 T-018)
  'customerPhone',
  '*.customerPhone',
  '*.*.customerPhone',
  'phone_number',
  '*.phone_number',
  '*.*.phone_number',
  'phoneNumber',
  '*.phoneNumber',
  'customerName',
  '*.customerName',

  // Internal storage locations — leaking these narrows an attacker's search
  // space for payment proofs (Doc 12 §7)
  'storageKey',
  '*.storageKey',
  'storage_key',
  '*.storage_key',

  // Request headers that carry sessions
  'req.headers.cookie',
  'req.headers.authorization',
  'headers.cookie',
  'headers.authorization',
]

function createLogger(): pino.Logger {
  const level = process.env.LOG_LEVEL ?? 'info'
  const isProd = process.env.NODE_ENV === 'production'

  return pino({
    level,
    redact: {
      paths: REDACT_PATHS,
      censor: REDACTED,
      remove: false,
    },
    base: {
      // Identifies which application instance produced the line once two PM2
      // instances are running (Doc 23 §11.5, Doc 24 §I.2).
      instance: process.env.INSTANCE_ID ?? process.env.PORT ?? 'app',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Raw JSON in production (Doc 16 §5.1). pino-pretty is loaded lazily in
    // development only; it is a devDependency and must not be required in prod.
    ...(isProd
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }),
  })
}

export const logger = createLogger()

/** Fields carried on every request-scoped log line (Doc 23 §12.4). */
export interface RequestLogContext {
  requestId: string
  method?: string
  path?: string
}

/** Child logger bound to a request, so all lines share the correlation id. */
export function requestLogger(context: RequestLogContext): pino.Logger {
  return logger.child(context)
}

export type Logger = pino.Logger
