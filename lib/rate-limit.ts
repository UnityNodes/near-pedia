export interface RateLimitIdentifiers {
  ip: string;
}

export function getIdentifiers(req: Request): RateLimitIdentifiers {
  // Priority order for real client IP:
  // 1. X-Real-IP          - set by OUR Caddy block to {client_ip}, which Caddy
  //                         derives via trusted_proxies + client_ip_headers.
  //                         Caddy OVERWRITES it, so a client can't forge it.
  // 2. CF-Connecting-IP   - only meaningful if Cloudflare sits in front; CF
  //                         strips any client-supplied value. Caddy does NOT
  //                         manage this header, so trusting it FIRST let a
  //                         direct client spoof it and rotate past per-IP limits.
  // 3. X-Forwarded-For    - first hop, last-resort fallback.
  let ip = 'unknown';
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) {
    ip = real;
  } else {
    const cfIp = req.headers.get('cf-connecting-ip')?.trim();
    if (cfIp) {
      ip = cfIp;
    } else {
      const xff = req.headers.get('x-forwarded-for');
      if (xff) {
        const first = xff.split(',')[0]?.trim();
        if (first) ip = first;
      }
    }
  }
  return { ip };
}
