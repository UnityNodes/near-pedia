import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { SITE as SITE_CONFIG } from '@/lib/site.config';

const SITE = SITE_CONFIG.url;

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const stripped = rawId.replace(/^CIP-/i, '');
  const id = /^\d+$/.test(stripped) ? stripped.padStart(4, '0') : stripped;

  const db = getDb();
  const cip = db.prepare('SELECT id, cip_number, title, status FROM cips WHERE id = ?').get(id) as
    { id: string; cip_number: number | null; title: string | null; status: string | null } | undefined;

  if (!cip) {
    return new Response('CIP not found', { status: 404 });
  }

  const history = db.prepare(`
    SELECT id, from_status, to_status, changed_at
    FROM cip_status_history
    WHERE cip_id = ?
    ORDER BY changed_at DESC
    LIMIT 50
  `).all(id) as Array<{ id: number; from_status: string | null; to_status: string; changed_at: string }>;

  const feedId = `cip/${id}`;
  const cipNum = String(cip.cip_number ?? cip.id).padStart(4, '0');
  const feedTitle = `CIP-${cipNum} · ${cip.title ?? 'Untitled'}`;
  const updated = history[0]?.changed_at ?? new Date(0).toISOString();

  const items = history.map(h => `
  <entry>
    <id>${esc(`${SITE}/cips/${id}#${h.id}`)}</id>
    <title>${esc(`CIP-${cipNum}: ${h.from_status ?? '(new)'} to ${h.to_status}`)}</title>
    <link href="${esc(`${SITE}/cips/${id}`)}" />
    <updated>${esc(h.changed_at)}</updated>
    <summary>${esc(`Status changed from ${h.from_status ?? '(new)'} to ${h.to_status} on ${h.changed_at.slice(0,10)}`)}</summary>
  </entry>`).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${esc(`${SITE}/api/feed/${feedId}`)}</id>
  <title>${esc(`${SITE_CONFIG.name} · ${feedTitle}`)}</title>
  <link href="${esc(`${SITE}/cips/${id}`)}" />
  <link rel="self" href="${esc(`${SITE}/api/feed/${feedId}`)}" />
  <updated>${esc(updated)}</updated>
  <subtitle>${esc(`Status change history for ${feedTitle}. Current status: ${cip.status ?? 'unknown'}.`)}</subtitle>
${items}
</feed>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
    },
  });
}
