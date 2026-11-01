import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import path from 'path';
import { getDb } from '@/lib/db';
import { SITE } from '@/lib/site.config';

export const runtime = 'nodejs';
export const alt = 'NEAR forum discussion';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface TopicRow {
  id: number;
  title: string | null;
  reply_count: number | null;
  views: number | null;
  last_post_at: string | null;
  category_id: number | null;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const topic = db.prepare(
    'SELECT id, title, reply_count, views, last_post_at, category_id FROM forum_topics WHERE id = ?'
  ).get(Number(id)) as TopicRow | undefined;

  const logoBuffer = await readFile(path.join(process.cwd(), 'public/logo-light.png'));
  const logoSrc = `data:image/png;base64,${logoBuffer.toString('base64')}`;

  const title = topic?.title ?? 'Forum discussion';
  const replies = topic?.reply_count ?? 0;
  const views = topic?.views ?? 0;
  const lastPost = topic?.last_post_at?.slice(0, 10) ?? '';

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
          <div style={{ fontSize: 22, opacity: 0.55, marginLeft: 8 }}>· forum discussion</div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 72,
            fontSize: 52,
            fontWeight: 700,
            lineHeight: 1.2,
            letterSpacing: -1,
            color: '#D4FF00',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {title}
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 32, fontSize: 22, opacity: 0.7 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ opacity: 0.6 }}>replies</span>
            <span style={{ fontWeight: 700, color: '#ffffff' }}>{replies}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ opacity: 0.6 }}>views</span>
            <span style={{ fontWeight: 700, color: '#ffffff' }}>{views.toLocaleString()}</span>
          </div>
          {lastPost && (
            <div style={{ marginLeft: 'auto', opacity: 0.5 }}>
              {`last post ${lastPost}`}
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
