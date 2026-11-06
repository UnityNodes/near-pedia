/**
 * backfill-video-dates.ts
 *
 * Fills youtube_videos.published_at for rows missing it (the channel-synced
 * rows from sync-youtube.ts that never got the watch-page enrichment). Pulls
 * the date straight from the embedded JSON on each video's watch page — same
 * `"publishDate":{"simpleText":...}` signal sync-youtube.ts uses, with
 * uploadDate / itemprop datePublished as fallbacks. Idempotent; safe to re-run.
 *
 *   PATH=/root/.nvm/versions/node/v22.18.0/bin:$PATH npx tsx scripts/backfill-video-dates.ts
 */
import { getDb } from '../lib/db';
import { NOT_YET_PUBLISHED } from '../lib/youtube-next';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const CONCURRENCY = 5;

interface Row { id: string; title: string | null; }

function parsePublishDate(s: string | null): string | null {
  if (!s || NOT_YET_PUBLISHED.test(s)) return null;
  const d = new Date(s);
  if (isNaN(d.getTime()) || d.getTime() > Date.now()) return null;
  return d.toISOString();
}

async function fetchDate(id: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en&gl=US`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const raw =
      html.match(/"publishDate":\{"simpleText":"([^"]+)"/)?.[1] ??
      html.match(/"uploadDate":"([0-9T:\-+.Z]+)"/)?.[1] ??
      html.match(/itemprop="datePublished" content="([^"]+)"/)?.[1] ??
      null;
    return parsePublishDate(raw);
  } catch {
    return null;
  }
}

async function main() {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, title FROM youtube_videos WHERE published_at IS NULL OR published_at = ''")
    .all() as Row[];
  console.log(`[backfill-dates] ${rows.length} videos missing published_at`);

  const update = db.prepare('UPDATE youtube_videos SET published_at = ? WHERE id = ?');
  let filled = 0;
  const failures: string[] = [];

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const res = await Promise.all(batch.map(async (r) => ({ r, d: await fetchDate(r.id) })));
    for (const { r, d } of res) {
      if (d) {
        update.run(d, r.id);
        filled++;
      } else {
        failures.push(`${r.id} (${(r.title ?? '').slice(0, 40)})`);
      }
    }
    console.log(`  ${Math.min(i + CONCURRENCY, rows.length)}/${rows.length} — ${filled} filled`);
  }

  console.log(`[backfill-dates] done: ${filled} filled, ${failures.length} unresolved`);
  if (failures.length) console.log('  unresolved:\n   ' + failures.slice(0, 20).join('\n   '));
}

main().catch((e) => {
  console.error('[backfill-dates] fatal:', e);
  process.exit(1);
});
