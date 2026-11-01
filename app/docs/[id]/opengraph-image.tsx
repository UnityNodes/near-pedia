import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import path from 'path';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const alt = 'YourChain documentation';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface DocRow {
  id: number;
  title: string | null;
  source: string | null;
  url: string | null;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const doc = db.prepare(
    'SELECT id, title, source, url FROM doc_pages WHERE id = ?'
  ).get(Number(id)) as DocRow | undefined;

  const logoBuffer = await readFile(path.join(process.cwd(), 'public/logo-light.png'));
  const logoSrc = `data:image/png;base64,${logoBuffer.toString('base64')}`;

  const title = doc?.title ?? 'YourChain documentation';
  const source = doc?.source ?? '';

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
          <div style={{ fontSize: 22, opacity: 0.55, marginLeft: 8 }}>· documentation</div>
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 72,
            fontSize: 54,
            fontWeight: 700,
            lineHeight: 1.2,
            letterSpacing: -1,
            color: '#D4FF00',
            WebkitLineClamp: 5,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {title}
        </div>

        {source && (
          <div
            style={{
              marginTop: 'auto',
              fontSize: 22,
              fontWeight: 700,
              padding: '8px 18px',
              border: '2px solid #888',
              color: '#aaa',
              textTransform: 'uppercase',
              letterSpacing: 1,
              alignSelf: 'flex-start',
            }}
          >
            {source}
          </div>
        )}
      </div>
    ),
    size,
  );
}
