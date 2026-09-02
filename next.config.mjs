import createNextIntlPlugin from 'next-intl/plugin'

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
    // pino, pg and sharp must not be bundled by webpack for the server runtime.
    // sharp ships native bindings that webpack cannot trace (Doc 22 §9.5).
    serverComponentsExternalPackages: ['pino', 'pino-pretty', 'pg', 'sharp'],
  },

  images: {
    /**
     * Remote image hosts (Doc 12 §3, Doc 24 §H.1).
     *
     * Public media is served from the Cloudflare R2 public bucket, whose base
     * URL is deployment-specific (`S3_PUBLIC_BASE_URL`). It is registered here
     * at build time so `next/image` will optimise it; anything else is refused.
     * Locally, media is served from this same origin under /media and needs no
     * entry.
     */
    remotePatterns: publicMediaPatterns(),
  },

  // Security headers are set in src/middleware.ts (Doc 24 §C.2) so that the
  // per-request CSP nonce can be generated. NGINX sets a belt-and-suspenders
  // subset at the edge (Doc 22 §14.5).
}

/**
 * Build the `next/image` allow-list from the configured public media origin.
 *
 * Returns an empty list when unset, which is the correct posture: no remote
 * host is trusted by default, and a build with no storage configured still
 * succeeds (a property Milestone 0 established and this must not break).
 */
function publicMediaPatterns() {
  const base = process.env.S3_PUBLIC_BASE_URL
  if (!base) return []

  try {
    const url = new URL(base)
    return [{ protocol: url.protocol.replace(':', ''), hostname: url.hostname }]
  } catch {
    return []
  }
}

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

export default withNextIntl(nextConfig)
