import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { adminRoles, adminUsers, customerAccounts } from '@/db/schema'
import { hashPassword } from '@/lib/auth/password'
import type { RoleName } from '@/lib/rbac/permissions'

/**
 * Account fixtures for the authentication integration tests.
 *
 * Roles come from the seed (`npm run db:seed`), which is a prerequisite for the
 * integration suite. Accounts are created with unique addresses per run and
 * removed afterwards, so repeated runs stay independent.
 */

let counter = 0

function unique(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}-${Math.floor(Math.random() * 1e6)}`
}

export interface TestAdmin {
  id: string
  email: string
  password: string
  roleId: string
  roleName: RoleName
}

export async function roleIdFor(roleName: RoleName): Promise<string> {
  const rows = await db
    .select({ id: adminRoles.id })
    .from(adminRoles)
    .where(eq(adminRoles.name, roleName))
    .limit(1)

  const role = rows[0]
  if (!role) {
    throw new Error(
      `Role "${roleName}" is missing. Run: npm run db:migrate && npm run db:migrate:raw && npm run db:seed`,
    )
  }
  return role.id
}

export async function createTestAdmin(
  options: {
    roleName?: RoleName
    password?: string
    mustChangePassword?: boolean
    isActive?: boolean
  } = {},
): Promise<TestAdmin> {
  const roleName = options.roleName ?? 'admin'
  const password = options.password ?? 'test-admin-password'
  const email = `${unique('admin')}@example.test`
  const roleId = await roleIdFor(roleName)

  const rows = await db
    .insert(adminUsers)
    .values({
      email,
      passwordHash: await hashPassword(password),
      fullName: 'Test Administrator',
      roleId,
      isActive: options.isActive ?? true,
      mustChangePassword: options.mustChangePassword ?? false,
    })
    .returning({ id: adminUsers.id })

  const created = rows[0]
  if (!created) throw new Error('Failed to create test administrator')

  return { id: created.id, email, password, roleId, roleName }
}

export interface TestCustomer {
  id: string
  email: string
  password: string
}

export async function createTestCustomer(
  options: { password?: string; googleId?: string | null } = {},
): Promise<TestCustomer> {
  const password = options.password ?? 'test-customer-password'
  const email = `${unique('customer')}@example.test`

  const rows = await db
    .insert(customerAccounts)
    .values({
      email,
      fullName: 'Test Customer',
      passwordHash: await hashPassword(password),
      googleId: options.googleId ?? null,
    })
    .returning({ id: customerAccounts.id })

  const created = rows[0]
  if (!created) throw new Error('Failed to create test customer')

  return { id: created.id, email, password }
}

const createdAdminIds: string[] = []
const createdCustomerIds: string[] = []

export function trackAdmin(admin: TestAdmin): TestAdmin {
  createdAdminIds.push(admin.id)
  return admin
}

export function trackCustomer(customer: TestCustomer): TestCustomer {
  createdCustomerIds.push(customer.id)
  return customer
}

/**
 * Remove tracked fixtures. Safe to call when nothing was created.
 *
 * Uses the MIGRATION connection, not the application pool: `app_user` is
 * granted SELECT, INSERT and UPDATE only and cannot DELETE from any table
 * (src/db/migrations/raw/0004_privileges.sql). Cleaning up test fixtures is a
 * maintenance operation, not something the application is allowed to do.
 */
export async function cleanupAccounts(): Promise<void> {
  if (createdAdminIds.length === 0 && createdCustomerIds.length === 0) return

  const { default: pg } = await import('pg')
  const client = new pg.Client({
    connectionString: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL,
    application_name: 'thefield-test-cleanup',
  })
  await client.connect()

  try {
    if (createdAdminIds.length > 0) {
      await client.query('DELETE FROM audit_logs WHERE admin_id = ANY($1::uuid[])', [
        createdAdminIds,
      ])
      await client.query('DELETE FROM admin_users WHERE id = ANY($1::uuid[])', [createdAdminIds])
      createdAdminIds.length = 0
    }
    if (createdCustomerIds.length > 0) {
      await client.query('DELETE FROM customer_accounts WHERE id = ANY($1::uuid[])', [
        createdCustomerIds,
      ])
      createdCustomerIds.length = 0
    }
  } finally {
    await client.end()
  }
}
