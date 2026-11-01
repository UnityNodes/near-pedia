import { SITE } from '@/lib/site.config';

export type ResultLink =
  | { internal: true; path: string }
  | { internal: false; href: string };

function siteHosts(): Set<string> {
  try {
    const host = new URL(SITE.url).hostname;
    return new Set([host, host.startsWith('www.') ? host.slice(4) : `www.${host}`]);
  } catch {
    return new Set();
  }
}

export function resultLink(url: string, currentHost: string): ResultLink {
  let parsed: URL;
  try {
    parsed = new URL(url, `https://${currentHost}`);
  } catch {
    return { internal: true, path: '/' };
  }
  const own = parsed.host === currentHost || siteHosts().has(parsed.hostname);
  if (own) return { internal: true, path: `${parsed.pathname}${parsed.search}${parsed.hash}` };
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { internal: true, path: '/' };
  return { internal: false, href: parsed.href };
}
