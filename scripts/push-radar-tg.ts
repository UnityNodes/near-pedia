import { getDb } from '../lib/db';
import { SITE } from '../lib/site.config';
import { isEntrypoint } from '../lib/is-entrypoint';

const TG_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

interface RadarItem {
  id: number;
  level: string;
  title: string;
  body: string | null;
  source_url: string | null;
  affects: string;
  deadline: string | null;
  published_at: string;
}

const LEVEL_EMOJI: Record<string, string> = {
  critical:  '🔴',
  important: '🟡',
  ecosystem: '🟢',
};

const AFFECT_LABEL: Record<string, string> = {
  validator: 'Validators',
  sv:        'Staking Operators',
  fa:        'Featured Apps',
  developer: 'Developers',
};

function formatMessage(item: RadarItem): string {
  const affects: string[] = JSON.parse(item.affects || '[]');
  const emoji = LEVEL_EMOJI[item.level] ?? '⚪';
  const level = item.level.toUpperCase();
  const affectsStr = affects.map(a => AFFECT_LABEL[a] ?? a).join(' · ');

  let msg = `${emoji} <b>${level}</b>`;
  if (affectsStr) msg += ` - ${affectsStr}`;
  msg += `\n\n<b>${item.title}</b>`;
  if (item.body) msg += `\n\n${item.body.slice(0, 300)}`;
  if (item.deadline) msg += `\n\n⏰ <b>Deadline: ${item.deadline}</b>`;
  if (item.source_url) msg += `\n\n<a href="${item.source_url}">Read more →</a>`;
  msg += `\n\n<i>via <a href="${SITE.url}/radar">${SITE.name} Radar</a></i>`;
  return msg;
}

async function sendTg(text: string) {
  const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TG_CHANNEL_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`TG API error: ${err}`);
  }
}

async function main() {
  // Was a top-level `if (!token) process.exit(0)` - process.exit() on mere
  // import is worse than the outbound-post-on-import problem this file's
  // isEntrypoint guard exists for: it would kill whatever process imported
  // this file, not just skip a function call. Now it's an ordinary runtime
  // check inside main(), which only ever runs behind the guard below.
  if (!TG_BOT_TOKEN || !TG_CHANNEL_ID) {
    console.log('[push-radar-tg] TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID not set, skipping');
    return;
  }

  const db = getDb();
  const pending = db.prepare(`
    SELECT * FROM radar_items
    WHERE tg_sent = 0 AND level IN ('critical', 'important')
    ORDER BY level ASC, published_at DESC
    LIMIT 10
  `).all() as RadarItem[];

  if (pending.length === 0) {
    console.log('[push-radar-tg] nothing to send');
    return;
  }

  const markSent = db.prepare('UPDATE radar_items SET tg_sent = 1 WHERE id = ?');

  for (const item of pending) {
    try {
      const msg = formatMessage(item);
      await sendTg(msg);
      markSent.run(item.id);
      console.log(`[push-radar-tg] sent: ${item.level} - ${item.title.slice(0, 60)}`);
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[push-radar-tg] failed for ${item.id}:`, err);
    }
  }

  console.log(`[push-radar-tg] done: ${pending.length} sent`);
}

if (isEntrypoint(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1); });
}
