import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { customerAccounts } from '@/db/schema'

/**
 * Customer account data access (Doc 22 M3-T10, Doc 24 §E.1).
 *
 * The account is THE customer identity. There is no phone-number lookup: a
 * phone number is contact data and must never authorise anything
 * (Doc 24 §E.1 obsolete-concepts table).
 */

export interface CustomerRecord {
  id: string
  email: string
  passwordHash: string | null
  googleId: string | null
  fullName: string
  phoneNumber: string | null
}

/** Safe projection. Never carries the password hash or internal notes. */
export interface CustomerProfile {
  id: string
  email: string
  fullName: string
  phoneNumber: string | null
}

export function toCustomerProfile(customer: CustomerRecord): CustomerProfile {
  return {
    id: customer.id,
    email: customer.email,
    fullName: customer.fullName,
    phoneNumber: customer.phoneNumber,
  }
}

const selection = {
  id: customerAccounts.id,
  email: customerAccounts.email,
  passwordHash: customerAccounts.passwordHash,
  googleId: customerAccounts.googleId,
  fullName: customerAccounts.fullName,
  phoneNumber: customerAccounts.phoneNumber,
}

const live = (condition: ReturnType<typeof eq>) =>
  and(condition, isNull(customerAccounts.deletedAt))

export async function findById(id: string): Promise<CustomerRecord | null> {
  const rows = await db
    .select(selection)
    .from(customerAccounts)
    .where(live(eq(customerAccounts.id, id)))
    .limit(1)
  return rows[0] ?? null
}

export async function findByEmail(email: string): Promise<CustomerRecord | null> {
  const rows = await db
    .select(selection)
    .from(customerAccounts)
    .where(live(eq(customerAccounts.email, email.toLowerCase())))
    .limit(1)
  return rows[0] ?? null
}

export async function findByGoogleId(googleId: string): Promise<CustomerRecord | null> {
  const rows = await db
    .select(selection)
    .from(customerAccounts)
    .where(live(eq(customerAccounts.googleId, googleId)))
    .limit(1)
  return rows[0] ?? null
}

export interface CreateCustomerInput {
  email: string
  fullName: string
  passwordHash?: string | null
  googleId?: string | null
  phoneNumber?: string | null
}

export async function create(input: CreateCustomerInput): Promise<CustomerRecord> {
  const rows = await db
    .insert(customerAccounts)
    .values({
      email: input.email.toLowerCase(),
      fullName: input.fullName,
      passwordHash: input.passwordHash ?? null,
      googleId: input.googleId ?? null,
      phoneNumber: input.phoneNumber ?? null,
    })
    .returning(selection)

  const created = rows[0]
  if (!created) throw new Error('Customer account insert returned no row')
  return created
}

/** Attach a Google identity to an account that was created with a password. */
export async function linkGoogleId(id: string, googleId: string): Promise<void> {
  await db
    .update(customerAccounts)
    .set({ googleId, updatedAt: new Date() })
    .where(eq(customerAccounts.id, id))
}
