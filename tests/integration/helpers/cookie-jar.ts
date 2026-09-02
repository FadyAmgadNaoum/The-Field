/**
 * In-memory cookie jar standing in for `next/headers` `cookies()`.
 *
 * Route handlers, iron-session and the CSRF helpers all read and write cookies
 * through that API. Substituting a jar lets the integration tests drive real
 * route handlers — real sessions, real encryption, real CSRF — while keeping
 * cookie state across calls the way a browser would.
 *
 * Only the surface those consumers actually use is implemented.
 */

export interface JarCookie {
  name: string
  value: string
  path?: string
}

export class CookieJar {
  private readonly store = new Map<string, JarCookie>()

  get(name: string): JarCookie | undefined {
    return this.store.get(name)
  }

  getAll(): JarCookie[] {
    return [...this.store.values()]
  }

  has(name: string): boolean {
    return this.store.has(name)
  }

  set(nameOrCookie: string | JarCookie, value?: string, options?: { path?: string }): void {
    if (typeof nameOrCookie === 'object') {
      this.store.set(nameOrCookie.name, nameOrCookie)
      return
    }
    this.store.set(nameOrCookie, {
      name: nameOrCookie,
      value: value ?? '',
      path: options?.path,
    })
  }

  delete(name: string): void {
    this.store.delete(name)
  }

  clear(): void {
    this.store.clear()
  }

  /** Snapshot for switching between simulated browsers or instances. */
  snapshot(): JarCookie[] {
    return this.getAll().map((cookie) => ({ ...cookie }))
  }

  restore(cookies: JarCookie[]): void {
    this.clear()
    for (const cookie of cookies) this.store.set(cookie.name, { ...cookie })
  }
}

/**
 * Single jar shared by the `next/headers` mock and the test body.
 *
 * Held on `globalThis` rather than in module scope so it survives
 * `vi.resetModules()`. The cross-instance session tests reset the module
 * registry to simulate a second Node process; a module-scoped jar would be
 * rebuilt with it, and each simulated instance would silently get its own
 * cookies — which is the opposite of what those tests need to prove. The jar
 * represents the browser, and the browser does not restart when the server does.
 */
const JAR_KEY = Symbol.for('thefield.test.cookieJar')

type GlobalWithJar = typeof globalThis & { [JAR_KEY]?: CookieJar }

export function getTestCookieJar(): CookieJar {
  const container = globalThis as GlobalWithJar
  container[JAR_KEY] ??= new CookieJar()
  return container[JAR_KEY]
}

/** Fresh jar — call between tests to simulate a new browser. */
export function resetTestCookieJar(): CookieJar {
  const container = globalThis as GlobalWithJar
  container[JAR_KEY] = new CookieJar()
  return container[JAR_KEY]
}
