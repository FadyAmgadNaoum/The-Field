import { UnauthorizedError } from '../errors'
import * as customerRepo from '@/modules/customers/customers.repository'
import { getCustomerSessionCookie } from './sessions'

/**
 * Customer session resolution (Doc 10 §3.1–3.5, Doc 24 §E.1).
 *
 * THE authorisation rule for every customer resource: identity comes from this
 * session and nowhere else. A customer id in a request body, query string or
 * path has no effect on what the caller can reach
 * (Doc 19 AC-CUS-010, Doc 24 §M item 4).
 */

export interface CustomerContext {
  customerId: string
  email: string
  fullName: string
}

export async function getCustomerSession(): Promise<CustomerContext | null> {
  const session = await getCustomerSessionCookie()
  if (!session.customerId) return null

  // Re-read the account so a deleted customer's cookie stops working
  // immediately rather than at cookie expiry.
  const customer = await customerRepo.findById(session.customerId)
  if (!customer) return null

  return {
    customerId: customer.id,
    email: customer.email,
    fullName: customer.fullName,
  }
}

/** Throws UnauthorizedError (401) when there is no valid customer session. */
export async function requireCustomerSession(): Promise<CustomerContext> {
  const context = await getCustomerSession()
  if (!context) throw new UnauthorizedError('Please sign in to continue.')
  return context
}

export async function establishCustomerSession(customer: {
  id: string
  email: string
}): Promise<void> {
  const session = await getCustomerSessionCookie()
  session.customerId = customer.id
  session.email = customer.email
  session.issuedAt = Date.now()
  await session.save()
}

export async function destroyCustomerSession(): Promise<void> {
  const session = await getCustomerSessionCookie()
  session.destroy()
}
