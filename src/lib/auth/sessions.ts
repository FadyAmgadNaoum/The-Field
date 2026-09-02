import { getIronSession, type IronSession, type SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'
import { getSessionSecret, isProduction } from '../config'

/**
 * Session architecture (Doc 10 §2, §3.1; Doc 22 §6.2; Doc 24 §E.3).
 *
 * iron-session encrypts the session payload inside the cookie itself. There is
 * no server-side session store, which is what makes the application stateless
 * and lets either PM2 instance validate a session issued by the other
 * (Doc 23 §1.3, §11.3, REL-M1-T02). Adding Redis or a sessions table would
 * reintroduce the shared state this design deliberately avoids.
 *
 * Administrator and customer sessions are separate cookie namespaces with
 * different paths, so a customer session can never authenticate an admin route
 * and vice versa (Doc 10 §1).
 */

export const ADMIN_SESSION_COOKIE = 'thefield_admin_session'
export const CUSTOMER_SESSION_COOKIE = 'thefield_customer_session'

/** Doc 10 §2.4 — 8 hours. */
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8
/** Doc 10 §3.1 — 7 days. */
export const CUSTOMER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

export interface AdminSessionData {
  adminId?: string
  roleId?: string
  /** Milliseconds. Compared against admin_users.sessions_invalidated_at. */
  issuedAt?: number
}

export interface CustomerSessionData {
  customerId?: string
  email?: string
  issuedAt?: number
}

export const adminSessionOptions: SessionOptions = {
  cookieName: ADMIN_SESSION_COOKIE,
  // Getter: reading the secret is deferred until a session is actually used, so
  // importing this module requires no valid environment (see config/index.ts).
  get password() {
    return getSessionSecret()
  },
  cookieOptions: {
    httpOnly: true,
    // Only sent over TLS in production. Development runs on plaintext
    // localhost, where a Secure cookie would never be transmitted at all.
    secure: isProduction,
    sameSite: 'lax',
    // Scoped to /admin: the admin cookie is not attached to public requests,
    // so a public-route vulnerability cannot reach an admin session
    // (Doc 10 §2.4).
    path: '/admin',
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  },
}

export const customerSessionOptions: SessionOptions = {
  cookieName: CUSTOMER_SESSION_COOKIE,
  get password() {
    return getSessionSecret()
  },
  cookieOptions: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: CUSTOMER_SESSION_MAX_AGE_SECONDS,
  },
}

/**
 * The admin cookie is scoped to `/admin`, but the admin API lives under
 * `/api/v1/admin`. A second cookie with the same payload and an `/api/v1/admin`
 * path keeps both reachable without widening either to `/`.
 */
export const adminApiSessionOptions: SessionOptions = {
  cookieName: ADMIN_SESSION_COOKIE,
  // Declared explicitly rather than spreading `adminSessionOptions`: a spread
  // would INVOKE the `password` getter at module load, which is exactly the
  // eager configuration read this design avoids.
  get password() {
    return getSessionSecret()
  },
  cookieOptions: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/v1/admin',
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  },
}

export async function getAdminSessionCookie(): Promise<IronSession<AdminSessionData>> {
  return getIronSession<AdminSessionData>(cookies(), adminSessionOptions)
}

export async function getAdminApiSessionCookie(): Promise<IronSession<AdminSessionData>> {
  return getIronSession<AdminSessionData>(cookies(), adminApiSessionOptions)
}

export async function getCustomerSessionCookie(): Promise<IronSession<CustomerSessionData>> {
  return getIronSession<CustomerSessionData>(cookies(), customerSessionOptions)
}
