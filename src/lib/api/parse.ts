import type { z } from 'zod'
import { ValidationError } from '../errors'

/**
 * Body parsing and validation (Doc 22 §5.2).
 *
 * Every route parses through this helper so that a malformed body produces a
 * controlled 400 rather than an unhandled exception, and so field errors reach
 * the client in one consistent shape.
 */
export async function parseJsonBody<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new ValidationError('Request body must be valid JSON.')
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    // `flatten` yields only field names and messages — never the submitted
    // values, which could contain a password.
    throw new ValidationError('The submitted data is not valid.', result.error.flatten())
  }

  return result.data
}
