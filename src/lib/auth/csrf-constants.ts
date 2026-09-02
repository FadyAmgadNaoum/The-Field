/**
 * CSRF constants shared with client components.
 *
 * `src/lib/auth/csrf.ts` imports `node:crypto` and `next/headers`, so it cannot
 * be pulled into a client bundle. The header name is needed on both sides, so
 * it lives here where either can import it safely.
 */
export const CSRF_HEADER = 'x-csrf-token'
export const CSRF_COOKIE = 'thefield_csrf'
