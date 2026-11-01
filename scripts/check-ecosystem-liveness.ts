/**
 * check-ecosystem-liveness - is each ecosystem project still there?
 *
 * Single-link only: this app's ecosystem_projects has no separate github_url column
 * (just one url per project), so the two-link "alive if ANY known link is
 * alive" logic collapses to the one link there is. Uses slug as the row
 * identity - this table has no id column, slug is its primary key.
 *
 * Before this check, ecosystem_projects had no liveness-tracking columns at
 * all (checked: PRAGMA table_info showed only
 * slug/title/description/category/url/tags/source/tier/synced_at/logo).
 * Added them here (and in sync-ecosystem.ts, so a fresh DB gets them from
 * either script first) rather than assume they already existed.
 *
 * Also found and fixed sync-ecosystem.ts using INSERT OR REPLACE: every
 * daily re-sync would have deleted-and-reinserted every row, silently
 * wiping fail_streak/dead_since/liveness back to their defaults the day
 * after this check first set them - the exact trap this app's own
 * CLAUDE.md documents for a different table. Converted to ON CONFLICT DO
 * UPDATE naming only the columns that sync owns.
 *
 * The catalog is fed by an upstream list that keeps a project long after it
 * has stopped existing, so a row being present says nothing about the
 * project being alive. This checks the link itself.
 *
 * What it does NOT do is delete anything. A dead project keeps its row and
 * gains a flag, for two reasons: a catalog that silently drops entries
 * cannot be audited, and one bad night on our side would erase real
 * projects.
 *
 * Verdict rules, in the order that matters:
 *
 *   dead signal        DNS does not resolve, connection refused, 404, 410
 *   alive signal       any 2xx or 3xx
 *   INCONCLUSIVE       403, 429, 5xx, timeouts, TLS errors
 *
 * The inconclusive class is the important one. Cloudflare answers 403 to
 * datacenter IPs, rate limiters answer 429, and a site being down for an
 * hour answers 503. None of that means the project is gone, so none of it
 * moves the counter in either direction.
 *
 * A project is only condemned after DEAD_STREAK consecutive dead signals on
 * separate runs, which at one run a day means it has to stay unreachable
 * for days before the flag flips.
 *
 * Usage:
 *   npx tsx scripts/check-ecosystem-liveness.ts              # check everything
 *   npx tsx scripts/check-ecosystem-liveness.ts --dry-run    # report, write nothing
 *   npx tsx scripts/check-ecosystem-liveness.ts --limit 50   # first 50 only
 *   npx tsx scripts/check-ecosystem-liveness.ts --slug foo   # one project
 */
import { getDb } from '../lib/db';
import { guardSync } from '../lib/sync-log';
import { SITE } from '../lib/site.config';

const CONCURRENCY = 10;          // simultaneous requests, not per host
const TIMEOUT_MS = 15000;
const DEAD_STREAK = 3;           // consecutive dead signals before condemning
const UA = `nearpedia-linkcheck/1.0 (+${SITE.url})`;

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? parseInt(process.argv[i + 1] ?? '0', 10) || 0 : 0;
})();
const ONLY_SLUG = (() => {
  const i = process.argv.indexOf('--slug');
  return i >= 0 ? process.argv[i + 1] ?? null : null;
})();

type Signal = 'alive' | 'dead' | 'inconclusive';

interface Row {
  slug: string;
  title: string;
  url: string | null;
  fail_streak: number;
  dead_since: string | null;
  last_check_at: string | null;
}

// A strike has to represent a separate occasion, not a separate invocation.
// Re-checks inside this window still report and still update the status,
// they just do not advance the counter.
const STRIKE_INTERVAL_MS = 6 * 3600 * 1000;

interface Result {
  row: Row;
  signal: Signal;
  status: number | null;
  note: string;
}

function isHttp(u: string | null | undefined): u is string {
  return !!u && /^https?:\/\//i.test(u.trim());
}

/**
 * Map a fetch rejection onto a verdict. Only a name that cannot be resolved
 * or a port that actively refuses is treated as gone; everything else
 * (timeout, TLS, reset) is a network mood, not evidence.
 */
function classifyError(err: unknown): { signal: Signal; note: string } {
  const cause = (err as { cause?: { code?: string } })?.cause;
  const code = cause?.code ?? (err as { code?: string })?.code ?? '';
  const msg = err instanceof Error ? err.message : String(err);

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { signal: 'dead', note: `dns:${code}` };
  if (code === 'ECONNREFUSED') return { signal: 'dead', note: 'connection refused' };
  if (msg.includes('aborted') || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return { signal: 'inconclusive', note: 'timeout' };
  }
  return { signal: 'inconclusive', note: `net:${code || msg.slice(0, 40)}` };
}

function classifyStatus(status: number): { signal: Signal; note: string } {
  if (status >= 200 && status < 400) return { signal: 'alive', note: `http ${status}` };
  if (status === 404 || status === 410) return { signal: 'dead', note: `http ${status}` };
  // 403 / 429 / 5xx: a wall or a wobble, not a grave. See the header comment.
  return { signal: 'inconclusive', note: `http ${status}` };
}

async function probe(url: string): Promise<{ signal: Signal; status: number | null; note: string }> {
  const attempt = async (method: 'HEAD' | 'GET') => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, {
        method,
        redirect: 'follow',
        signal: ac.signal,
        headers: { 'User-Agent': UA, 'Accept': '*/*' },
      });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    let res = await attempt('HEAD');
    // HEAD is widely half-implemented, and a wrong answer here is expensive:
    // it is what produces a public "dead" label. Any non-success HEAD is
    // re-asked with GET, and only GET's answer counts.
    if (res.status < 200 || res.status >= 400) {
      try { res = await attempt('GET'); } catch { /* keep the HEAD verdict */ }
    }
    const { signal, note } = classifyStatus(res.status);
    return { signal, status: res.status, note };
  } catch (err) {
    const { signal, note } = classifyError(err);
    return { signal, status: null, note };
  }
}

async function checkOne(row: Row): Promise<Result> {
  if (!isHttp(row.url)) {
    return { row, signal: 'inconclusive', status: null, note: 'no http link to check' };
  }

  const r = await probe(row.url);
  let note = r.note;

  // A 404 on a deep link says the page moved, not that the project is gone.
  // Checking the site root separates "this URL rotted, fix it" from "this
  // project no longer exists", which are different jobs for whoever
  // reviews.
  if (r.signal === 'dead' && (r.status === 404 || r.status === 410)) {
    const root = `${new URL(row.url).origin}/`;
    if (root !== row.url) {
      const rootRes = await probe(root);
      note = rootRes.signal === 'alive'
        ? `${note} (link rot: site root is up)`
        : `${note} (site root is down too)`;
    } else {
      note = `${note} (this is the site root)`;
    }
  }

  return { row, signal: r.signal, status: r.status, note: note.slice(0, 300) };
}

/** Runs tasks with at most `limit` in flight, preserving input order in results. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** ecosystem_projects predates these columns; add whichever are missing. */
function ensureColumns(db: ReturnType<typeof getDb>): void {
  const cols = db.prepare('PRAGMA table_info(ecosystem_projects)').all() as Array<{ name: string }>;
  const has = (name: string) => cols.some((c) => c.name === name);
  for (const [name, type] of [
    ['liveness', 'TEXT'], ['url_status', 'TEXT'], ['last_check_at', 'TEXT'],
    ['http_status', 'INTEGER'], ['check_note', 'TEXT'],
    ['fail_streak', 'INTEGER DEFAULT 0'], ['dead_since', 'TEXT'], ['last_activity_at', 'TEXT'],
  ]) {
    if (!has(name)) db.exec(`ALTER TABLE ecosystem_projects ADD COLUMN ${name} ${type}`);
  }
}

async function main() {
  const db = getDb();
  ensureColumns(db);
  const now = new Date().toISOString();

  const where: string[] = [];
  const params: unknown[] = [];
  if (ONLY_SLUG) { where.push('slug = ?'); params.push(ONLY_SLUG); }
  const rows = db.prepare(`
    SELECT slug, title, url, fail_streak, dead_since, last_check_at
    FROM ecosystem_projects
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY last_check_at IS NOT NULL, last_check_at ASC
    ${LIMIT ? 'LIMIT ' + LIMIT : ''}
  `).all(...params) as Row[];

  if (rows.length === 0) { console.log('[eco-liveness] nothing to check'); return; }
  console.log(`[eco-liveness] checking ${rows.length} project(s), ${CONCURRENCY} at a time${DRY_RUN ? ' (dry run)' : ''}`);

  const results: Result[] = [];
  let done = 0;
  const onResult = (r: Result) => {
    results.push(r);
    if (++done % 100 === 0) console.log(`[eco-liveness] ${done}/${rows.length}`);
  };
  await pool(rows, CONCURRENCY, async row => {
    const r = await checkOne(row);
    onResult(r);
    return r;
  });

  const update = db.prepare(`
    UPDATE ecosystem_projects
    SET liveness = ?, url_status = ?, last_check_at = ?, http_status = ?, check_note = ?,
        fail_streak = ?, dead_since = ?
    WHERE slug = ?
  `);

  const tally = { alive: 0, suspect: 0, dead: 0, inconclusive: 0, condemned: [] as string[], revived: [] as string[] };

  const write = db.transaction((rs: Result[]) => {
    for (const r of rs) {
      let streak = r.row.fail_streak;
      let deadSince = r.row.dead_since;

      if (r.signal === 'alive') {
        if (streak > 0) tally.revived.push(r.row.slug);
        streak = 0;
        deadSince = null;
      } else if (r.signal === 'dead') {
        const lastMs = r.row.last_check_at ? Date.parse(r.row.last_check_at) : NaN;
        const freshOccasion = Number.isNaN(lastMs) || Date.now() - lastMs >= STRIKE_INTERVAL_MS;
        if (freshOccasion) {
          streak += 1;
          if (streak === 1) deadSince = now;   // stamp the start of the streak
        }
      }
      // inconclusive: leave the streak exactly where it was.

      let liveness: string;
      if (r.signal === 'inconclusive' && streak === 0) liveness = 'unknown';
      else if (streak >= DEAD_STREAK) liveness = 'dead';
      else if (streak > 0) liveness = 'suspect';
      else liveness = 'alive';

      if (liveness === 'dead' && r.row.fail_streak < DEAD_STREAK) tally.condemned.push(r.row.slug);
      if (liveness === 'alive') tally.alive++;
      else if (liveness === 'suspect') tally.suspect++;
      else if (liveness === 'dead') tally.dead++;
      else tally.inconclusive++;

      if (!DRY_RUN) {
        update.run(liveness, r.signal, now, r.status, r.note, streak, deadSince, r.row.slug);
      }
    }
  });
  write(results);

  console.log(`[eco-liveness] alive ${tally.alive}, suspect ${tally.suspect}, dead ${tally.dead}, unknown ${tally.inconclusive}`);
  if (tally.condemned.length) console.log(`[eco-liveness] newly dead (${DEAD_STREAK} strikes): ${tally.condemned.join(', ')}`);
  if (tally.revived.length) console.log(`[eco-liveness] back from the dead: ${tally.revived.join(', ')}`);
  if (DRY_RUN) console.log('[eco-liveness] dry run: nothing written');

  if (!DRY_RUN) {
    try {
      db.prepare('INSERT INTO sync_log (source, status, items_synced, ran_at) VALUES (?, ?, ?, ?)')
        .run('ecosystem-liveness', 'success', results.length, now);
    } catch { /* optional */ }
  }
}

guardSync('ecosystem-liveness', main).catch(e => { console.error('[eco-liveness] FATAL', e); process.exit(1); });
