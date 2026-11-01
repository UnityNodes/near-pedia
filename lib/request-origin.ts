/**
 * Did this request come from the box itself?
 *
 * Two endpoints need the same answer for different reasons - /api/health hides
 * the build commit from the public, /api/metrics refuses public scraping - and
 * two copies of "is this local" would drift into two different definitions of
 * local. One implementation, one place to correct.
 *
 * Caddy fronts the public host and forwards the client address; a call made
 * straight to the loopback port carries no forwarding header and its Host is
 * the loopback address. Anything else is treated as remote, which is the safe
 * direction: a misconfigured proxy makes a local caller look remote and hides
 * a field, never the reverse.
 */

/**
 * The rule itself, over a header lookup. Two servers ask it - the Next routes
 * with a fetch Request and the Express app in mcp-server.ts with its own - and
 * a second copy of "is this local" is how the two would come to disagree.
 */
export function isLocalByHeaders(get: (name: string) => string | null | undefined): boolean {
  const h = { get: (n: string) => get(n) ?? null };
  return coreIsLocal(h);
}

/** Express: headers are a plain object, and may arrive as string[]. */
export function isLocalCallExpress(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  return isLocalByHeaders((n) => {
    const v = req.headers[n.toLowerCase()];
    return Array.isArray(v) ? v[v.length - 1] : v;
  });
}

export function isLocalCall(req: Request): boolean {
  return coreIsLocal(req.headers);
}

function coreIsLocal(h: { get(name: string): string | null }): boolean {
  const forwarded = h.get('x-forwarded-for') ?? h.get('x-real-ip');
  if (forwarded) {
    // THE LAST ENTRY, not the first. X-Forwarded-For grows left to right and
    // only the RIGHTMOST value was written by our own proxy; everything before
    // it is whatever the client sent. Reading the first entry makes the header
    // self-service: `curl -H 'X-Forwarded-For: 127.0.0.1'` through Caddy would
    // come back with the build commit from /api/health, which is the exposure
    // this function exists to close.
    const parts = forwarded.split(',').map(x => x.trim()).filter(Boolean);
    let closest = parts[parts.length - 1] ?? '';
    // Some Next versions inject x-forwarded-for themselves when none arrives,
    // and write a plain IPv4 loopback as the IPv4-mapped form `::ffff:127.0.0.1`.
    closest = closest.replace(/^\[|\]$/g, '').replace(/^::ffff:/i, '');
    return closest.startsWith('127.') || closest === '::1';
  }
  const host = (h.get('host') ?? '').split(':')[0];
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
}
