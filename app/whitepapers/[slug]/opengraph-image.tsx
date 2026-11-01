import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import path from 'path';
import { getWhitepaperBySlug } from '@/lib/whitepapers';
import { SITE } from '@/lib/site.config';

export const runtime = 'nodejs';
export const alt = 'NEAR whitepaper';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const wp = getWhitepaperBySlug(slug);

  const logoBuffer = await readFile(path.join(process.cwd(), 'public/logo-light.png'));
  const logoSrc = `data:image/png;base64,${logoBuffer.toString('base64')}`;

  const title = wp?.title ?? 'NEAR whitepaper';
  const description = wp?.description ?? '';
  const tag = wp?.tag ?? '';
  const pages = wp?.pages;

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
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>{SITE.name}</div>
          <div style={{ fontSize: 22, opacity: 0.55, marginLeft: 8 }}>· whitepaper</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 64, gap: 28 }}>
          <div
            style={{
              fontSize: 54,
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
          {description && (
            <div
              style={{
                fontSize: 26,
                lineHeight: 1.4,
                opacity: 0.75,
                display: '-webkit-box',
                WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {description}
            </div>
          )}
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          {tag && (
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                padding: '8px 18px',
                border: '2px solid #D4FF00',
                color: '#D4FF00',
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              {tag}
            </div>
          )}
          {pages != null && (
            <div style={{ fontSize: 22, opacity: 0.6 }}>
              {`${pages} pages`}
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
