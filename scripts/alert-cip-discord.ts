import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { SITE } from '../lib/site.config';
import { isEntrypoint } from '../lib/is-entrypoint';

// Discord alerts for CIP lifecycle: a new CIP appears, or a CIP becomes
// Approved. Driven off the cips table STATE (not cip_status_history, which can
// carry duplicate rows) with a cip_alert_sent (cip_id, event) ledger so each
// event fires exactly once. On the very first run it SEEDS the ledger from the
// current corpus and posts nothing - so enabling alerts never replays the
// whole CIP history into the channel.
//
// Config (from .env.production, sourced by deploy/sync-tick.sh):
//   DISCORD_CIP_WEBHOOK_URL  - required; the channel webhook
//   DISCORD_CIP_THREAD_ID    - optional; post into this thread instead of the
//                              channel root (appended as ?thread_id=…)

const WEBHOOK = process.env.DISCORD_CIP_WEBHOOK_URL;
const THREAD_ID = process.env.DISCORD_CIP_THREAD_ID;

interface CipRow { id: string; cip_number: number | null; title: string | null; status: string | null; author: string | null }

function numLabel(c: CipRow): string {
  return c.cip_number != null ? `CIP-${String(c.cip_number).padStart(4, '0')}` : `CIP ${c.id}`;
}

function payloadFor(c: CipRow, event: 'created' | 'approved') {
  const label = numLabel(c);
  // YourChain has no "Approved" status - the terminal states are Final/Living.
  // A CIP that is not yet terminal is a proposal, so say so instead of
  // announcing a Draft as if it were settled.
  const isSettled = ['final', 'living'].includes((c.status || '').toLowerCase());
  const heading = event === 'approved'
    ? `✅ CIP Final - ${label}`
    : isSettled ? `🆕 New CIP - ${label}` : `🆕 New CIP proposal - ${label}`;
  return {
    // Top-level content + allowed_mentions is what actually PINGS the channel
    // (an embed alone never pings). Requires the webhook's channel to permit
    // @everyone mentions; otherwise Discord just renders it as plain text.
    content: '@everyone',
    allowed_mentions: { parse: ['everyone'] },
    embeds: [{
      title: heading,
      url: `${SITE.url}/cips/${c.id}`,
      description: c.title ? `**${c.title}**` : undefined,
      color: event === 'approved' ? 0x22c55e : 0x6366f1,
      fields: [
        { name: 'Status', value: c.status || '-', inline: true },
        { name: 'Author', value: (c.author || 'n/a').slice(0, 100), inline: true },
      ],
      footer: { text: `${SITE.name} · ${SITE.url.replace(/^https?:\/\//, '')}` },
    }],
  };
}

async function post(payload: object): Promise<boolean> {
  let url = WEBHOOK!;
  if (THREAD_ID) url += (url.includes('?') ? '&' : '?') + `thread_id=${THREAD_ID}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status === 429) {
    const j = await res.json().catch(() => ({ retry_after: 1 })) as { retry_after?: number };
    await new Promise(r => setTimeout(r, (j.retry_after ?? 1) * 1000 + 250));
    return post(payload);
  }
  if (!res.ok) console.warn(`[alert-cip-discord] Discord HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`);
  return res.ok;
}

async function main() {
  const db = getDb();
  const markSent = db.prepare('INSERT OR IGNORE INTO cip_alert_sent (cip_id, event, sent_at) VALUES (?, ?, ?)');
  const now = new Date().toISOString();

  // First run → seed ledger from current state, post nothing.
  const seeded = (db.prepare('SELECT COUNT(*) c FROM cip_alert_sent').get() as { c: number }).c > 0;
  if (!seeded) {
    const all = db.prepare('SELECT id, status FROM cips').all() as { id: string; status: string | null }[];
    const seed = db.transaction(() => {
      for (const c of all) {
        markSent.run(c.id, 'created', now);
        if (['final', 'living'].includes((c.status || '').toLowerCase())) markSent.run(c.id, 'approved', now);
      }
    });
    seed();
    console.log(`[alert-cip-discord] seeded ${all.length} CIPs (no alerts on first run).`);
    return;
  }

  if (!WEBHOOK) { console.log('[alert-cip-discord] DISCORD_CIP_WEBHOOK_URL not set - skipping.'); return; }

  // New CIPs not yet announced.
  const newCips = db.prepare(`
    SELECT id, cip_number, title, status, author FROM cips
    WHERE id NOT IN (SELECT cip_id FROM cip_alert_sent WHERE event = 'created')
    ORDER BY CAST(cip_number AS INTEGER) ASC
  `).all() as CipRow[];

  // Newly-finalised CIPs not yet announced. YourChain's terminal statuses are
  // Final/Living; 'approved' (the YourChain vocabulary) never occurs, so the old
  // filter matched zero rows and this half of the alerter was dead code.
  const approvedCips = db.prepare(`
    SELECT id, cip_number, title, status, author FROM cips
    WHERE LOWER(status) IN ('final', 'living')
      AND id NOT IN (SELECT cip_id FROM cip_alert_sent WHERE event = 'approved')
    ORDER BY CAST(cip_number AS INTEGER) ASC
  `).all() as CipRow[];

  let sent = 0;
  for (const c of newCips) {
    if (await post(payloadFor(c, 'created'))) { markSent.run(c.id, 'created', now); sent++; console.log(`[alert-cip-discord] new: ${numLabel(c)}`); }
    await new Promise(r => setTimeout(r, 400));
  }
  for (const c of approvedCips) {
    if (await post(payloadFor(c, 'approved'))) { markSent.run(c.id, 'approved', now); sent++; console.log(`[alert-cip-discord] approved: ${numLabel(c)}`); }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`[alert-cip-discord] done. ${sent} alert(s) sent (${newCips.length} new, ${approvedCips.length} approved pending).`);
}

if (isEntrypoint(import.meta.url)) {
  main().catch(e => { console.error('FATAL', e); process.exit(1); });
}
