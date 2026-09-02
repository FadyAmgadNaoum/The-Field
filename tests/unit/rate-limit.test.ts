import { RateLimiterMemory } from 'rate-limiter-flexible'
import { describe, expect, it } from 'vitest'
import { RateLimitError } from '@/lib/errors'
import { accountKey, consume, ipKey, reset } from '@/lib/rate-limit'

/** Rate limiting (Doc 11 §7, Doc 24 §I.6). */

function request(headers: Record<string, string>): Request {
  return new Request('https://thefield.eg/api/v1/auth/login', { headers })
}

describe('key derivation', () => {
  it('keys on the address NGINX restored into x-real-ip', () => {
    expect(ipKey(request({ 'x-real-ip': '41.0.0.7' }), 'admin-login')).toBe(
      'admin-login:ip:41.0.0.7',
    )
  })

  it('falls back to the first x-forwarded-for entry', () => {
    expect(ipKey(request({ 'x-forwarded-for': '41.0.0.9, 10.0.0.1' }), 'login')).toBe(
      'login:ip:41.0.0.9',
    )
  })

  it('prefers x-real-ip over x-forwarded-for', () => {
    // x-forwarded-for is client-appendable; x-real-ip is set by our own proxy.
    const key = ipKey(request({ 'x-real-ip': '41.0.0.7', 'x-forwarded-for': '1.2.3.4' }), 'login')
    expect(key).toBe('login:ip:41.0.0.7')
  })

  it('buckets an unidentifiable client conservatively rather than skipping the limit', () => {
    expect(ipKey(request({}), 'login')).toBe('login:ip:unknown')
  })

  it('separates scopes so one endpoint cannot exhaust another’s budget', () => {
    const headers = { 'x-real-ip': '41.0.0.7' }
    expect(ipKey(request(headers), 'admin-login')).not.toBe(
      ipKey(request(headers), 'customer-login'),
    )
  })

  it('normalises account keys so casing cannot multiply the budget', () => {
    expect(accountKey('customer-login', 'Person@Example.COM')).toBe(
      'customer-login:account:person@example.com',
    )
  })
})

describe('consume', () => {
  it('allows requests up to the limit', async () => {
    const limiter = new RateLimiterMemory({ points: 3, duration: 60 })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(consume(limiter, 'key-a')).resolves.toBeUndefined()
    }
  })

  it('throws RateLimitError once the limit is exceeded', async () => {
    const limiter = new RateLimiterMemory({ points: 2, duration: 60 })
    await consume(limiter, 'key-b')
    await consume(limiter, 'key-b')

    await expect(consume(limiter, 'key-b')).rejects.toBeInstanceOf(RateLimitError)
  })

  it('surfaces a 429, never an unhandled rejection', async () => {
    // rate-limiter-flexible rejects with a plain result object, not an Error.
    // Left unnormalised that would become a 500 (Doc 22 §5.6).
    const limiter = new RateLimiterMemory({ points: 1, duration: 60 })
    await consume(limiter, 'key-c')

    const error = await consume(limiter, 'key-c').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(RateLimitError)
    expect((error as RateLimitError).status).toBe(429)
    expect((error as RateLimitError).code).toBe('RATE_LIMITED')
  })

  it('tells the caller when to retry without leaking internals', async () => {
    const limiter = new RateLimiterMemory({ points: 1, duration: 60 })
    await consume(limiter, 'key-d')
    const error = (await consume(limiter, 'key-d').catch((caught: unknown) => caught)) as Error
    expect(error.message).toMatch(/try again in \d+ seconds/)
  })

  it('isolates keys from one another', async () => {
    const limiter = new RateLimiterMemory({ points: 1, duration: 60 })
    await consume(limiter, 'key-e')
    await expect(consume(limiter, 'key-f')).resolves.toBeUndefined()
  })
})

describe('reset', () => {
  it('clears a key so an honest user is not punished for an earlier typo', async () => {
    const limiter = new RateLimiterMemory({ points: 2, duration: 60 })
    await consume(limiter, 'key-g')
    await consume(limiter, 'key-g')
    await reset(limiter, 'key-g')

    await expect(consume(limiter, 'key-g')).resolves.toBeUndefined()
  })
})
