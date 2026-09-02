import { z } from 'zod'
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from '../auth/password'

/**
 * Authentication request schemas (Doc 11 §6, Doc 22 §5.2).
 *
 * Zod is the single source of truth for request shape. Only the fields listed
 * here are ever read from a request body — which is what makes mass assignment
 * structurally impossible: `customerId`, `roleId`, `isActive`,
 * `mustChangePassword` and every other server-managed field are simply not in
 * the schema, so submitting them has no effect (Doc 21 SF-006).
 */

const email = z
  .string({ required_error: 'Email address is required.' })
  .trim()
  .min(3, 'Email address is required.')
  .max(255, 'Email address is too long.')
  .email('Enter a valid email address.')
  .transform((value) => value.toLowerCase())

/**
 * Login accepts any non-empty password.
 *
 * Applying the strength policy at login would reject a legitimate holder of a
 * pre-policy credential, and would tell an attacker which candidates are even
 * worth trying. Strength is enforced where passwords are SET.
 */
const loginPassword = z
  .string({ required_error: 'Password is required.' })
  .min(1, 'Password is required.')
  .max(512, 'Password is too long.')

const newPassword = z
  .string({ required_error: 'Password is required.' })
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= MAX_PASSWORD_BYTES,
    `Password must not exceed ${MAX_PASSWORD_BYTES} bytes.`,
  )

export const customerRegisterSchema = z
  .object({
    email,
    password: newPassword,
    fullName: z
      .string({ required_error: 'Your name is required.' })
      .trim()
      .min(2, 'Your name is required.')
      .max(255, 'Name is too long.'),
  })
  .strict()

export const customerLoginSchema = z.object({ email, password: loginPassword }).strict()

export const adminLoginSchema = z.object({ email, password: loginPassword }).strict()

export const adminChangePasswordSchema = z
  .object({
    currentPassword: loginPassword,
    newPassword,
  })
  .strict()

export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>
export type CustomerLoginInput = z.infer<typeof customerLoginSchema>
export type AdminLoginInput = z.infer<typeof adminLoginSchema>
export type AdminChangePasswordInput = z.infer<typeof adminChangePasswordSchema>
