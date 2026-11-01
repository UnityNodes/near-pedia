import { getDb } from '../lib/db';
import { guardSync } from '../lib/sync-log';

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Monday 00:00 UTC of an ISO week, so a past week can be rebuilt exactly. */
function isoWeekStart(week: string): Date {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) throw new Error(`bad week "${week}", expected YYYY-Www`);
  const [, y, w] = m;
  // 4 January is always in ISO week 1, so anchor on it and step whole weeks.
  const jan4 = new Date(Date.UTC(Number(y), 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (jan4Day - 1) * 86400_000);
  return new Date(week1Monday.getTime() + (Number(w) - 1) * 7 * 86400_000);
}

function main() {
const db = getDb();

// `--week=2026-W26` rebuilds a past week. All 12 stored digests were written by
// the version whose newCips filter was a no-op, and they cannot be corrected by
// waiting: nothing regenerates a week once it has passed.
const weekArg = process.argv.find(a => a.startsWith('--week='))?.slice('--week='.length);
const now = new Date();
const weekStr = weekArg ?? isoWeek(now);
const weekEnd = weekArg ? new Date(isoWeekStart(weekArg).getTime() + 7 * 86400_000) : now;
const cutoff = new Date(weekEnd.getTime() - 7 * 86400_000).toISOString();
// Every query needs BOTH ends. With only a lower bound, rebuilding 2026-W26
// would sweep in everything from that Monday to today and file it under W26.
const upper = weekEnd.toISOString();

// CIPs that appeared upstream during the week.
//
// This filtered on `synced_at`, which is OUR clock: sync-cips refreshes every
// CIP on every run, so `synced_at > cutoff` matched all 52 rows every time and
// the filter did nothing. What survived was `ORDER BY cip_number DESC LIMIT 10`,
// which is "the ten highest-numbered CIPs" and has no week in it at all. All 12
// stored digests, 2026-W25 through W36, show this: the top CIP number only
// changes when a new one is actually created, otherwise it repeats identically.
//
// `created_date` would be a poor replacement. It is the date the author typed
// into the frontmatter, so a CIP added to the repo in July claiming January is
// invisible in July and was never visible in January either.
//
// The arrival rows in cip_status_history are the observed answer: sync-cips
// records one row with from_status IS NULL per CIP the first time it's seen,
// so an arrival is when the CIP was actually first indexed.
const newCips = db.prepare(`
  SELECT c.id, c.cip_number, c.title, c.status, MIN(h.changed_at) AS arrived_at
  FROM cips c
  JOIN cip_status_history h ON h.cip_id = c.id
  WHERE h.from_status IS NULL
  GROUP BY c.id
  HAVING arrived_at > ? AND arrived_at < ?
  ORDER BY arrived_at DESC
  LIMIT 10
`).all(cutoff, upper) as Array<{ id: string; cip_number: number | null; title: string | null; status: string | null; arrived_at: string }>;

// Status changes
const changes = db.prepare(`
  SELECT h.cip_id, c.cip_number, c.title, h.from_status, h.to_status
  FROM cip_status_history h LEFT JOIN cips c ON c.id = h.cip_id
  WHERE h.changed_at > ? AND h.changed_at < ? ORDER BY h.changed_at DESC LIMIT 10
`).all(cutoff, upper) as Array<{ cip_id: string; cip_number: number | null; title: string | null; from_status: string | null; to_status: string }>;

// Top forum topics
const topForum = db.prepare(`
  SELECT id, title, reply_count, views FROM forum_topics
  WHERE last_post_at > ? AND last_post_at < ? ORDER BY reply_count DESC LIMIT 5
`).all(cutoff, upper) as Array<{ id: number; title: string | null; reply_count: number; views: number }>;

// New blog posts
const blogs = db.prepare(`
  SELECT id, title, author, published_at FROM blog_posts
  WHERE published_at > ? AND published_at < ? ORDER BY published_at DESC LIMIT 5
`).all(cutoff, upper) as Array<{ id: string; title: string | null; author: string | null; published_at: string | null }>;

const payload = {
  week: weekStr,
  generatedAt: now.toISOString(),
  newCips,
  changes,
  topForum,
  blogs,
};

db.prepare(`
  INSERT INTO weekly_digests (week, payload, generated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(week) DO UPDATE SET payload = excluded.payload, generated_at = excluded.generated_at
`).run(weekStr, JSON.stringify(payload), now.toISOString());

console.log(`[build-weekly-digest] week=${weekStr} cips=${newCips.length} changes=${changes.length} forum=${topForum.length} blogs=${blogs.length}`);

  return newCips.length + changes.length + topForum.length + blogs.length;
}

guardSync('weekly-digest', main).catch(e => { console.error(e); process.exit(1); });
