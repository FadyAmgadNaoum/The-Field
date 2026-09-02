/**
 * Next.js configuration.
 *
 * NOTE ON FILE EXTENSION: Doc 22 §3 lists `next.config.ts`. TypeScript config files
 * are only supported from Next.js 15. This project targets Next.js 14 (Doc 22 §2,
 * Doc 24 §C.4), so `.mjs` is the correct extension. Recorded as an implementation
 * detail in the Milestone 0 report.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Required in Next.js 14 for src/instrumentation.ts to be loaded.
  // Used for graceful shutdown registration (Doc 24 §I.7).
  experimental: {
    instrumentationHook: true,
    // pino and pg must not be bundled by webpack for the server runtime.
    serverComponentsExternalPackages: ['pino', 'pino-pretty', 'pg'],
  },

  // Security headers are set in src/middleware.ts (Doc 24 §C.2) so that the
  // per-request CSP nonce can be generated. NGINX sets a belt-and-suspenders
  // subset at the edge (Doc 22 §14.5).
}

export default nextConfig
