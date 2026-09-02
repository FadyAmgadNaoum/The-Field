import { z } from 'zod'

/**
 * Environment variable validation (Doc 22 M0-T07, Doc 23 REL-M1-T04, Doc 24 §I.4).
 *
 * Rules enforced here:
 *  - Validation happens at module load, not on first request, so a misconfigured
 *    deployment fails immediately and visibly instead of at 3am under traffic.
 *  - BOOKING_EXPIRY_MINUTES has NO DEFAULT. OBD-002 is an unresolved business
 *    decision and the application must refuse to start rather than invent one
 *    (Doc 22 Preamble #4, Doc 23 §13.8 rule 8).
 *  - No secret is ever exposed to the client. Only NEXT_PUBLIC_* values are
 *    inlined by Next.js, and none of them hold secrets.
 *
 * Two schemas exist deliberately:
 *  - databaseEnv: the subset needed by migration and seed scripts. These run
 *    BEFORE a venue row exists, so they cannot require VENUE_ID.
 *  - serverEnv: everything the running application needs.
 */

const nonEmpty = (label: string) =>
  z.string({ required_error: `${label} is required` }).min(1, `${label} must not be empty`)

const postgresUrl = (label: string) =>
  nonEmpty(label).refine(
    (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
    `${label} must be a PostgreSQL connection string (postgres:// or postgresql://)`,
  )

const positiveInt = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .regex(/^\d+$/, `${label} must be a whole number`)
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value > 0, `${label} must be greater than zero`)

const optionalPositiveInt = (label: string, fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : value))
    .pipe(
      z.union([
        z.number(),
        z
          .string()
          .regex(/^\d+$/, `${label} must be a whole number`)
          .transform((value) => Number.parseInt(value, 10)),
      ]),
    )

export const nodeEnvSchema = z.enum(['development', 'test', 'production'])
export type NodeEnvironment = z.infer<typeof nodeEnvSchema>

/** Subset required by migration and seed scripts. */
export const databaseEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  DATABASE_URL: postgresUrl('DATABASE_URL'),
  DATABASE_MIGRATION_URL: postgresUrl('DATABASE_MIGRATION_URL').optional(),
  DB_POOL_MAX: optionalPositiveInt('DB_POOL_MAX', 10),
  DB_POOL_MIN: optionalPositiveInt('DB_POOL_MIN', 2),
})

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>

/** Everything the running application requires. */
export const serverEnvSchema = databaseEnvSchema
  .extend({
    PORT: optionalPositiveInt('PORT', 3000),
    NEXT_PUBLIC_SITE_URL: z.string().url('NEXT_PUBLIC_SITE_URL must be an absolute URL').optional(),

    // Venue scope is server-side only and never accepted from a request
    // (Doc 10 §4.4, Doc 24 §M item 16).
    VENUE_ID: z
      .string()
      .uuid('VENUE_ID must be a UUID — run `npm run db:seed` to create the venue'),
    VENUE_SLUG: z.string().min(1).default('the-field'),

    // Must be identical on every instance so sessions survive instance switching
    // (Doc 23 §11.3).
    SESSION_SECRET: nonEmpty('SESSION_SECRET').min(
      32,
      'SESSION_SECRET must be at least 32 characters — generate with: openssl rand -hex 64',
    ),

    // Production must be 's3'. Enforced by a superRefine below.
    STORAGE_PROVIDER: z.enum(['s3', 'local'], {
      required_error: 'STORAGE_PROVIDER is required',
      invalid_type_error: "STORAGE_PROVIDER must be 's3' or 'local'",
    }),

    // OBD-002 — unresolved. No default, on any environment.
    BOOKING_EXPIRY_MINUTES: positiveInt('BOOKING_EXPIRY_MINUTES'),
    BOOKING_EXPIRY_JOB_INTERVAL_MINUTES: optionalPositiveInt(
      'BOOKING_EXPIRY_JOB_INTERVAL_MINUTES',
      15,
    ),

    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    SHUTDOWN_DRAIN_MS: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.STORAGE_PROVIDER === 'local') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_PROVIDER'],
        message:
          "STORAGE_PROVIDER must be 's3' in production. Local disk storage would put payment " +
          'proofs on the VPS filesystem, which is prohibited (Doc 23 §16.6, Doc 24 §H.1).',
      })
    }
    if (env.NODE_ENV === 'production' && !env.NEXT_PUBLIC_SITE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NEXT_PUBLIC_SITE_URL'],
        message: 'NEXT_PUBLIC_SITE_URL is required in production',
      })
    }
    if (env.DB_POOL_MIN > env.DB_POOL_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DB_POOL_MIN'],
        message: 'DB_POOL_MIN must not exceed DB_POOL_MAX',
      })
    }
  })

export type ServerEnv = z.infer<typeof serverEnvSchema>

/** Raised when the process environment is missing or malformed. */
export class EnvironmentValidationError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(
      [
        'Invalid environment configuration. The application cannot start.',
        ...issues.map((issue) => `  - ${issue}`),
        '',
        'See .env.example for the full list of variables and their meaning.',
      ].join('\n'),
    )
    this.name = 'EnvironmentValidationError'
    this.issues = issues
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })
}

/** Parse the subset needed by migration and seed scripts. Throws on failure. */
export function parseDatabaseEnv(source: NodeJS.ProcessEnv = process.env): DatabaseEnv {
  const result = databaseEnvSchema.safeParse(source)
  if (!result.success) throw new EnvironmentValidationError(formatIssues(result.error))
  return result.data
}

/** Parse the full application environment. Throws on failure. */
export function parseServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(source)
  if (!result.success) throw new EnvironmentValidationError(formatIssues(result.error))
  return result.data
}
