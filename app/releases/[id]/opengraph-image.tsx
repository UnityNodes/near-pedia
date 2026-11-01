import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import path from 'path';
import { findRelease } from '@/lib/releases';

export const runtime = 'nodejs';
export const alt = 'YourChain release notes';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = findRelease(id);

  const logoBuffer = await readFile(path.join(process.cwd(), 'public/logo-light.png'));
  const logoSrc = `data:image/png;base64,${logoBuffer.toString('base64')}`;

  const title = item?.title ?? 'YourChain release notes';
  const excerpt = item?.summary ?? '';
  const published = item?.date?.slice(0, 10) ?? '';
  const tag = item?.name ?? 'release';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#0A0B0F',
          color: '#ffffff',
          padding: '64px 80px',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <img src={logoSrc} width={64} height={64} style={{ objectFit: 'contain' }} />
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>YOURPEDIA</div>
          <div style={{ fontSize: 22, opacity: 0.55, marginLeft: 8 }}>{`· ${tag}`}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 64, gap: 28 }}>
          <div
            style={{
              fontSize: 50,
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: -1,
              color: '#D4FF00',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {title}
          </div>
          {excerpt && (
            <div
              style={{
                fontSize: 24,
                lineHeight: 1.4,
                opacity: 0.75,
                display: '-webkit-box',
                WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {excerpt}
            </div>
          )}
        </div>

        {published && (
          <div style={{ marginTop: 'auto', fontSize: 22, opacity: 0.5 }}>
            {published}
          </div>
        )}
      </div>
    ),
    size,
  );
}
