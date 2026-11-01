import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import path from 'path';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const alt = 'Chain Improvement Proposal';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

import { STATUS_COLORS as STATUS_COLOR } from '@/lib/status';
import { formatAuthor } from '@/lib/utils';

interface CipRow {
  id: string;
  cip_number: number | null;
  title: string | null;
  status: string | null;
  type: string | null;
  author: string | null;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const cip = db.prepare(
    'SELECT id, cip_number, title, status, type, author FROM cips WHERE id = ?'
  ).get(id) as CipRow | undefined;

  const logoBuffer = await readFile(path.join(process.cwd(), 'public/logo-light.png'));
  const logoSrc = `data:image/png;base64,${logoBuffer.toString('base64')}`;

  const num = cip?.cip_number ?? id;
  const title = cip?.title ?? 'Chain Improvement Proposal';
  const status = cip?.status ?? 'Unknown';
  const type = cip?.type ?? '';
  const author = formatAuthor(cip?.author);
  const statusColor = STATUS_COLOR[status] ?? '#D4FF00';

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
          <div style={{ fontSize: 22, opacity: 0.55, marginLeft: 8 }}>· yourchain improvement proposal</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 56, gap: 24 }}>
          <div style={{ fontSize: 56, fontWeight: 800, color: '#D4FF00', letterSpacing: -1.5 }}>
            {`CIP-${String(num).padStart(4, '0')}`}
          </div>
          <div
            style={{
              fontSize: 52,
              fontWeight: 700,
              lineHeight: 1.15,
              letterSpacing: -1,
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {title}
          </div>
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              padding: '8px 18px',
              border: `2px solid ${statusColor}`,
              color: statusColor,
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            {status}
          </div>
          {type && (
            <div style={{ fontSize: 22, opacity: 0.7 }}>
              {type}
            </div>
          )}
          {author && (
            <div style={{ fontSize: 22, opacity: 0.5, marginLeft: 'auto' }}>
              {author.length > 40 ? author.slice(0, 40) + '…' : author}
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
