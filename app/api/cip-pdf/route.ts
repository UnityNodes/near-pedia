import { NextRequest, NextResponse } from 'next/server';
import { SITE } from '@/lib/site.config';

const ALLOWED_BASE = 'https://raw.githubusercontent.com/your-org/CIPs/';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');

  if (!url || !url.startsWith(ALLOWED_BASE)) {
    return new NextResponse('Invalid URL', { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { 'User-Agent': `${SITE.name}/1.0` },
      // A PDF is a few MB from GitHub, so this is generous. Without it the
      // visitor's own request inherits whatever GitHub does, with no ceiling.
      signal: AbortSignal.timeout(20_000),
      // The allowlist above is checked against the URL we were given; a
      // redirect would leave it behind and fetch somewhere else on our behalf.
      redirect: 'error',
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    return new NextResponse(timedOut ? 'Upstream timed out' : 'Upstream unavailable', {
      status: timedOut ? 504 : 502,
    });
  }

  if (!upstream.ok) {
    return new NextResponse('Not found', { status: upstream.status });
  }

  const buffer = await upstream.arrayBuffer();
  const filename = decodeURIComponent(url.split('/').pop() ?? 'document.pdf');

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
