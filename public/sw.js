/* NEARpedia Service Worker
   v1: offline-resilient cache for shell + reads.
   v2: cache invalidation after Cloudflare Email Obfuscation removal —
       stale shells were still injecting cdn-cgi/email-decode script.
   Bumping the version below invalidates all old caches on next load. */
const VERSION = 'v6';
const RUNTIME = `nearpedia-runtime-${VERSION}`;
const SHELL = `nearpedia-shell-${VERSION}`;

// Minimal app shell — what should load even with no network.
const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/brand/logo-horizontal-light.svg',
  '/brand/logo-horizontal-dark.svg',
  '/favicon.svg',
  '/icon-192.png',
];

// Paths the SW must never cache or touch.
function isBypassed(url) {
  const p = url.pathname;
  return p.startsWith('/api/health')         // always fresh
      || p.startsWith('/api/metrics')        // private
      || p.startsWith('/api/csp-report')     // write-only, never a response worth keeping
      || p.startsWith('/_next/data')         // RSC payloads w/ revalidate
      || p.includes('/opengraph-image')      // dynamic OG generation
      || p.includes('/twitter-image');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(SHELL_URLS).catch(() => { /* tolerate single 404 */ });
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== SHELL && k !== RUNTIME)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Strategy:
//   - GET only.
//   - Bypassed paths → straight to network.
//   - Same-origin /_next/static (content-hashed, immutable): stale-while-revalidate from RUNTIME cache.
//   - Same-origin everything else (pages, RSC payloads, data): network first, the cache only when offline,
//     so a deploy shows on the first visit after it instead of one visit later.
//   - Cross-origin (e.g. youtube.com thumbnails): network-only.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isBypassed(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME);
    const cached = await cache.match(req);

    const network = fetch(req)
      .then((res) => {
        // Only cache successful, basic responses (no opaque, no redirects).
        if (res && res.status === 200 && res.type === 'basic') {
          event.waitUntil(cache.put(req, res.clone()));
        }
        return res;
      })
      .catch(() => null);

    if (cached && url.pathname.startsWith('/_next/static/')) {
      event.waitUntil(network);
      return cached;
    }

    const res = await network;
    if (cached && (!res || res.status >= 500)) return cached;
    if (res) return res;

    // Offline + no cache: serve the shell '/' as a last-ditch HTML so
    // the navigation doesn't show the browser's offline screen.
    if (req.mode === 'navigate') {
      const shellRes = await caches.match('/');
      if (shellRes) return shellRes;
    }
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  })());
});

// Allow the page to nudge the SW to update — see components/service-worker-register.tsx.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
