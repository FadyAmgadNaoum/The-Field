/**
 * Unit test environment.
 *
 * Provides a complete, valid configuration so that modules which validate the
 * environment at load time can be imported. Values are deliberately fake.
 *
 * DATABASE_URL points at a closed port so that any code path which genuinely
 * attempts to connect fails fast with ECONNREFUSED. That is what lets the
 * readiness test verify the real 503 branch without a database.
 */
// Next.js types NODE_ENV as readonly; tests legitimately need to set it.
const mutableEnv = process.env as Record<string, string | undefined>
mutableEnv.NODE_ENV ??= 'test'

process.env.VENUE_ID ??= '00000000-0000-4000-8000-000000000000'
process.env.VENUE_SLUG ??= 'the-field'
process.env.SESSION_SECRET ??= 'unit-test-session-secret-value-not-a-real-secret'
process.env.DATABASE_URL ??= 'postgresql://app_user:unit-test@127.0.0.1:1/thefield_unit'
process.env.STORAGE_PROVIDER ??= 'local'
process.env.BOOKING_EXPIRY_MINUTES ??= '120'
process.env.LOG_LEVEL ??= 'silent'
process.env.SHUTDOWN_DRAIN_MS ??= '0'
