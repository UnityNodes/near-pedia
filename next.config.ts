import type { NextConfig } from "next";
import { REMOTE_IMAGES } from "./lib/remote-images";

// Content-Security-Policy is set per-request by middleware.ts so
// each response carries a fresh nonce. Other headers don't depend
// on per-request state and live here.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // HSTS. No includeSubDomains/preload on purpose - subdomains (stats., errors.)
  // are separate services and shouldn't be force-HTTPS-pinned from the apex.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
];

/**
 * The commit this build was made from, frozen into the bundle.
 *
 * Read at CONFIG LOAD, which for `next build` is build time, and Next inlines
 * the value. It must NOT be recomputed at runtime: `next start` loads this file
 * too, and a sha read then would be HEAD rather than what is actually running,
 * which is the one answer that would make check-deployed.ts's comparison useless.
 */
function buildCommit(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('node:child_process') as typeof import('node:child_process'))
      .execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
  } catch {
    // Absent rather than invented. A wrong sha is worse than no sha.
    return '';
  }
}

const nextConfig: NextConfig = {
  env: { BUILD_COMMIT: buildCommit() },
  // `next start` reads chunks from disk lazily, so `npm run build` into the live
  // .next can serve broken asset manifests until the restart lands. Building into
  // .next.new and swapping afterwards keeps that window to two renames. Defaults
  // to .next, so nothing changes unless the variable is set (see CLAUDE.md).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  images: {
    remotePatterns: REMOTE_IMAGES.map((p) => ({ ...p })),
  },
  reactCompiler: true,
  experimental: {
    // Tree-shake icon barrel imports so client bundles only ship used icons.
    optimizePackageImports: ['lucide-react'],
  },
  serverExternalPackages: ['better-sqlite3', 'sqlite-vec'],
  async redirects() {
    return [
      {
        // /stats was the content-growth page. Its live counts now live in the
        // homepage widget and on /sources; permanent so search results and any
        // external link land somewhere useful instead of a 404.
        source: '/stats',
        destination: '/sources',
        permanent: true,
      },
    ];
  },
  turbopack: {
    resolveAlias: {
      voyageai: './node_modules/voyageai/dist/cjs/extended/index.js',
      '@huggingface/transformers': './lib/stubs/huggingface-transformers.js',
    },
  },
  outputFileTracingIncludes: {
    '/**': ['./data/**'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      // Mutating / streaming / private endpoints must NOT be cached.
      // RSS feeds (/api/feed/*) and other public GET endpoints set their
      // own Cache-Control headers and intentionally fall through to the
      // generic /api/* security-only rule below.
      {
        source: '/api/health',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/api/metrics',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/api/csp-report',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/api/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // Service Worker script - must NEVER be cached at the edge, only
      // briefly in the browser. Otherwise users get stuck on an old
      // SW that itself caches old assets, until a hard refresh.
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

import { withSentryConfig } from '@sentry/nextjs';

export default withSentryConfig(nextConfig, {
  // Skip source-map upload - we don't have a Sentry release CLI on prod,
  // and GlitchTip works fine on minified frames. Re-enable later.
  silent: true,
  widenClientFileUpload: false,
  sourcemaps: { disable: true },
  disableLogger: true,
  tunnelRoute: '/monitoring',
});
