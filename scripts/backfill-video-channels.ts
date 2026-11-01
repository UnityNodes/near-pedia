/**
 * backfill-video-channels.ts
 *
 * Fills youtube_videos.channel_name for rows that are missing it (the videos
 * imported by migrate-from-nearpedia.ts carried published_at but not the
 * channel). Source of truth: YouTube oEmbed (`author_name`), public, no API key.
 * Idempotent + safe to re-run; only touches rows whose channel is empty.
 *
 *   PATH=/root/.nvm/versions/node/v22.18.0/bin:$PATH npx tsx scripts/backfill-video-channels.ts
 */
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'cips.db');
const CONCURRENCY = 6;

interface Row { id: string; title: string | null; }

async function oembedChannel(id: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
      { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { author_name?: string };
    return j.author_name?.trim() || null;
  } catch {
    return null;
  }
}

async function main() {
  const db = new Database(DB_PATH);
  const rows = db
    .prepare("SELECT id, title FROM youtube_videos WHERE channel_name IS NULL OR channel_name = ''")
    .all() as Row[];
  console.log(`[backfill-channels] ${rows.length} videos missing channel_name`);

  const update = db.prepare('UPDATE youtube_videos SET channel_name = ? WHERE id = ?');
  let filled = 0;
  const failures: string[] = [];

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (r) => ({ r, ch: await oembedChannel(r.id) })));
    for (const { r, ch } of results) {
      if (ch) {
        update.run(ch, r.id);
        filled++;
      } else {
        failures.push(`${r.id} (${(r.title ?? '').slice(0, 40)})`);
      }
    }
    console.log(`  ${Math.min(i + CONCURRENCY, rows.length)}/${rows.length} processed — ${filled} filled`);
  }

  console.log(`[backfill-channels] done: ${filled} filled, ${failures.length} unresolved`);
  if (failures.length) console.log('  unresolved (video private/deleted?):\n   ' + failures.join('\n   '));
  db.close();
}

main().catch((e) => {
  console.error('[backfill-channels] fatal:', e);
  process.exit(1);
});
