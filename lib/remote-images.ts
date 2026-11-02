/**
 * Remote image hosts next/image may proxy. next.config.ts reads this list for
 * images.remotePatterns, and pages ask isProxiedImage before handing a URL to
 * next/image, which throws (and 500s the whole page) on any other host: one
 * catalog project with its logo on its own site took /ecosystem down.
 */
export const REMOTE_IMAGES = [
  { protocol: 'https', hostname: 'i.ytimg.com' },
  { protocol: 'https', hostname: 'img.youtube.com' },
  { protocol: 'https', hostname: 'indexer.nearcatalog.xyz', pathname: '/wp-content/**' },
] as const;

export function isProxiedImage(src: string | null | undefined): src is string {
  if (!src) return false;
  try {
    const u = new URL(src);
    return REMOTE_IMAGES.some((p) => u.protocol === `${p.protocol}:` && u.hostname === p.hostname
      && (!('pathname' in p) || u.pathname.startsWith(p.pathname.replace('/**', '/'))));
  } catch {
    return false;
  }
}
