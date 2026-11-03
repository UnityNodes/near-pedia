import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import path from 'path';
import { getDb } from '@/lib/db';
import { SITE } from '@/lib/site.config';
import { OG_FONT_FAMILY, ogFonts } from '@/lib/og-fonts';

export const runtime = 'nodejs';
export const alt = 'NEAR video';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface VideoRow {
  id: string;
  title: string | null;
  channel_name: string | null;
  published_at: string | null;
  thumbnail_url: string | null;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const video = db.prepare(
    'SELECT id, title, channel_name, published_at, thumbnail_url FROM youtube_videos WHERE id = ?'
  ).get(id) as VideoRow | undefined;

  const logoBuffer = await readFile(path.join(process.cwd(), 'public', SITE.logo.mark));
  const logoSrc = `data:image/svg+xml;base64,${logoBuffer.toString('base64')}`;

  const title = video?.title ?? 'NEAR video';
  const channel = video?.channel_name ?? '';
  const published = video?.published_at?.slice(0, 10) ?? '';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#0B0B0C',
          color: '#F2F2EE',
          padding: '64px 80px',
          fontFamily: OG_FONT_FAMILY,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <img src={logoSrc} width={64} height={64} style={{ objectFit: 'contain' }} />
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>{SITE.name}</div>
          <div style={{ fontSize: 22, opacity: 0.55, marginLeft: 8 }}>· video</div>
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 72,
            fontSize: 52,
            fontWeight: 700,
            lineHeight: 1.2,
            letterSpacing: -1,
            color: '#00EC97',
            WebkitLineClamp: 5,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {title}
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 16, fontSize: 22, opacity: 0.65 }}>
          {channel && <div>{channel}</div>}
          {published && <div style={{ marginLeft: 'auto' }}>{published}</div>}
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
