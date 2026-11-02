import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Per-request CSP nonce.
 *
 * Without a nonce we'd need 'unsafe-inline' on script-src so the
 * many <script type="application/ld+json"> JSON-LD payloads can run.
 * With one we emit a fresh base64 nonce per request, propagate it to
 * RSC via the `x-csp-nonce` header (read by the JsonLd component),
 * and add `'nonce-<…>'` + `'strict-dynamic'` to script-src.
 *
 * 'strict-dynamic' lets nonce'd scripts spawn further scripts (the
 * Next.js client bootstrap chain) without manually listing every URL.
 *
 * connect-src allows the Sentry DSN's origin when NEXT_PUBLIC_SENTRY_DSN
 * is set, so the browser SDK can report; nothing else leaves the page.
 *
 * Skipped for /api/* and static asset paths because:
 *  - /api/* responses are JSON / streams, no CSP relevant.
 *  - /_next/static is byte-identical across requests; per-request
 *    nonce would defeat the immutable cache.
 */
function originOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return ` ${new URL(url).origin}`;
  } catch {
    return '';
  }
}

const SENTRY_ORIGIN = originOf(process.env.NEXT_PUBLIC_SENTRY_DSN);

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith('/api/') || path.startsWith('/_next/') || path === '/sw.js') {
    return NextResponse.next();
  }

  // crypto.randomUUID is widely available in the Edge runtime.
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  let nonce = '';
  for (const b of nonceBytes) nonce += b.toString(16).padStart(2, '0');

  const csp = [
    "default-src 'self'",
    // 'unsafe-eval' + 'wasm-unsafe-eval' are required by the @sentry/nextjs
    // browser SDK for source-map decoding and WebAssembly stack-trace parsing.
    // nonce + 'strict-dynamic' still gate script injection - eval() can't be
    // triggered by an attacker who can't inject a script tag in the first place.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com https://gov.near.org https://*.discourse-cdn.com",
    "media-src 'self'",
    "frame-src 'self' https://www.youtube-nocookie.com",
    `connect-src 'self'${SENTRY_ORIGIN}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    'upgrade-insecure-requests',
    'report-uri /api/csp-report',
  ].join('; ');

  // Forward the nonce to RSC so server components can echo it in the
  // <script nonce="…"> attribute of every inline JSON-LD payload.
  const headers = new Headers(request.headers);
  headers.set('x-csp-nonce', nonce);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: [
    // Run for every path except the explicit skip list inside the
    // function (api/static). Keeps the matcher pattern simple.
    '/((?!api|_next/static|_next/image|favicon.ico|sw\\.js).*)',
  ],
};
