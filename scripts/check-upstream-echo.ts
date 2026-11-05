/**
 * Does the table still hold what the sync said it fetched?
 *
 * check-completeness re-asks upstream "how many do you have". That works where
 * the answer is one cheap request: a sitemap, a feed, a single data file. It
 * does NOT work for a paginated API where the only way to count is to walk
 * every page — doing that a second time each day would double our load on
 * somebody else's servers to learn what the sync already knew an hour earlier.
 *
 * So this asks the cheaper, complementary question. The sync walked the whole
 * upstream set and recorded how many it saw. Do we still hold that many? A
 * difference means the rows went missing AFTER the fetch:
 *
 *   - a prune deleted more than it should have
 *   - a transaction failed part way and nothing said so
 *   - something wrote over them
 *
 * None of which check-completeness would notice, because it compares us to
 * upstream rather than us to ourselves an hour ago.
 *
 * WHAT items_synced MEANS IS DECLARED, NOT GUESSED. It is a full-set count for
 * some syncs and a this-run delta for others, and comparing a delta to a table
 * size would manufacture a finding every day. sync-youtube reports new videos
 * this run, not the channel total; several syncs here don't report a count at
 * all today because their entry point never returns one to guardSync, even
 * where they do walk their upstream to completion. Those are listed below as
 * not-comparable rather than quietly skipped, because an unreported gap in a
 * check reads exactly like a pass.
 *
 *   npx tsx scripts/check-upstream-echo.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { isoNowSql } from '../lib/formats';
import { DOCS_ORIGIN } from '../lib/near-docs';

/**
 * Does this sync report a number it read back out of the table we compare it to?
 *
 * The declaration below says what items_synced means, and a declaration is a
 * claim about code that can drift from the code. So the claim is verified
 * rather than trusted: the sync's source is read, every identifier assigned
 * from a COUNT over the compared table is collected, and if the value handed
 * to sync_log is one of them the comparison is refused. A sync that logs
 * `SELECT COUNT(*) FROM <the same table>` taken right after the write would
 * otherwise compare a number against itself, which passes every night and
 * proves nothing.
 *
 * It reads source with a regex, so it can miss an indirection it cannot see. A
 * miss leaves the check exactly where it was before this existed; a hit is
 * always real, because nothing counts its own table by accident.
 */
function selfReferential(sync: string, table: string): boolean {
  const candidates = [`sync-${sync}.ts`, `${sync}.ts`];
  const file = candidates
    .map(c => path.join(process.cwd(), 'scripts', c))
    .find(p => fs.existsSync(p));
  if (!file) return false;
  const src = fs.readFileSync(file, 'utf-8');

  const counters = new Set<string>();
  const assign = new RegExp(
    String.raw`(?:const|let|var)\s+(\w+)[^\n;]*SELECT\s+COUNT\(\*\)[^\n;]*FROM\s+["'\`]?${table}\b`,
    'g',
  );
  for (const m of src.matchAll(assign)) counters.add(m[1]);
  if (counters.size === 0) return false;

  const logged: string[] = [];
  for (const m of src.matchAll(/sync_log[^;]*?\.run\(\s*([^)]*)\)/g)) logged.push(m[1]);
  for (const m of src.matchAll(/logRun\([^,]+,\s*\{([^}]*)\}/g)) logged.push(m[1]);
  for (const m of src.matchAll(/return\s+(\w+)\s*;/g)) logged.push(m[1]);

  return logged.some(args =>
    [...counters].some(c => new RegExp(String.raw`\b${c}\b(?:\.\w+)?`).test(args)),
  );
}

type Semantics = 'full-set' | 'delta' | 'unreported';

interface Echo {
  /** sync_log.source, i.e. what the sync calls itself. */
  sync: string;
  table: string;
  semantics: Semantics;
  /**
   * The sync owns only part of the table; compare within its own slice.
   * A raw SQL boolean expression (developer-authored, never user input) —
   * e.g. `source = 'docs'` or `tags LIKE '%blog%'`. Equality alone doesn't
   * cover every real split here (blog_posts is scoped by a comma-joined
   * tags column, not a single value).
   */
  scopeWhere?: string;
  why: string;
}

/**
 * One line per sync that writes a table anyone reads. Adding a sync and not
 * adding it here is caught by the tail of this file, not by nobody.
 */
const ECHOES: Echo[] = [
  {
    sync: 'docs', table: 'doc_pages', semantics: 'full-set',
    // source='docs' alone is NOT this sync's scope - sync-docs.ts's own prune
    // logic says so explicitly: github.com/yoursdk/docs/... rows and hand-seeded
    // *.md rows (e.g. SKILL.md) also carry source='docs' but are never written
    // or counted by this file. Measured live: source='docs' held 106, this
    // sync's own slice (its prune-eligibility filter) held 71, matching
    // items_synced exactly. A bare source='docs' scope would have manufactured
    // a permanent 35-row false mismatch.
    scopeWhere: `source = 'docs' AND url LIKE '${DOCS_ORIGIN}/%' AND url NOT LIKE '%.md'`,
    why: 'fetches one full llms-full.txt dump of the whole docs corpus every run and refuses to write if nothing parsed',
  },
  {
    sync: 'github-releases', table: 'github_releases', semantics: 'delta',
    why: 'reports the releases it wrote this run: the 15-minute run sends each repo\'s stored ETag and skips a repo that answers 304, and only the daily --full run reads every page, so the figure is never the table total',
  },
  {
    sync: 'blog', table: 'blog_posts', semantics: 'delta',
    why: 'reports the posts it wrote this run: the sitemap is read whole, but only URLs it does not hold yet are fetched (all of them with --full), and pruning is confirmed separately by pruneConfirmingUrls',
  },
  {
    sync: 'ecosystem', table: 'ecosystem_projects', semantics: 'full-set',
    why: 'single non-paginated upstream file, walked whole every run; throws loudly on a moved/404 source rather than writing nothing quietly',
  },
  {
    sync: 'github-discussions', table: 'github_discussions', semantics: 'full-set',
    why: 'pages each repo\'s discussions to hasNextPage=false every run; a genuine fetch failure now aborts the run (rather than silently under-counting and still reporting success) so a partial fetch cannot pass as a completed one',
  },
  {
    sync: 'youtube-transcripts', table: 'youtube_videos', semantics: 'delta',
    why: 'only backfills transcript_text on existing rows for whatever is still pending this run; never inserts or deletes, so it never moves the table\'s row count and 0 pending is a normal, expected result',
  },
  {
    sync: 'youtube', table: 'youtube_videos', semantics: 'delta',
    why: 'reports (when it reports at all) new videos found this run, not the channel total; 0 new videos is the normal answer once a channel is caught up',
  },
  {
    sync: 'github-items', table: 'github_items', semantics: 'delta',
    why: 'only fetches state=open issues and flips vanished-open ones to closed in place; never represents the whole table, which also holds historical closed items from other sources',
  },
  {
    sync: 'forum', table: 'forum_topics', semantics: 'unreported',
    why: "topics are fully re-crawled each run but posts are an explicitly bounded incremental backfill (PER_RUN stale topics only), so a single count could never validly stand for both. lib/forum.ts also writes forum_topics/forum_posts on a live visitor cache-miss, entirely outside this sync's control - a third reason a single run-count wouldn't mean 'the whole set'.",
  },
  {
    sync: 'network-stats', table: 'network_stats', semantics: 'unreported',
    why: 'an internal aggregator that reads counts out of other tables and appends exactly one capped snapshot row per run; comparing that to network_stats\' rolling-window row count would be meaningless regardless of what it reported',
  },
];

function main(): void {
  const db = getDb();
  const problems: string[] = [];
  const notComparable: string[] = [];
  let checked = 0;

  const voided: string[] = [];

  for (const e of ECHOES) {
    if (e.semantics !== 'full-set') {
      notComparable.push(`${e.sync} (${e.semantics}: ${e.why})`);
      continue;
    }

    // Refused before it is run, not reported as a pass afterwards. A comparison
    // whose two sides are one number is not a weak check, it is no check, and
    // counting it among the ones that passed is how it stayed invisible.
    if (selfReferential(e.sync, e.table)) {
      voided.push(`${e.sync}: reports a COUNT over ${e.table}, the table it is compared against`);
      continue;
    }

    const last = db.prepare(`
      SELECT items_synced, ran_at FROM sync_log
      WHERE source = ? AND status = 'success' AND items_synced IS NOT NULL
      ORDER BY ran_at DESC LIMIT 1
    `).get(e.sync) as { items_synced: number; ran_at: string } | undefined;

    if (!last) {
      problems.push(`${e.sync}: no successful run has ever reported a count`);
      continue;
    }

    const where = e.scopeWhere ? ` WHERE ${e.scopeWhere}` : '';
    let held = 0;
    try {
      held = (db.prepare(`SELECT COUNT(*) c FROM "${e.table}"${where}`).get() as { c: number }).c;
    } catch (err) {
      problems.push(`${e.sync}: cannot count ${e.table} (${(err as Error).message.slice(0, 60)})`);
      continue;
    }

    checked++;
    if (held !== last.items_synced) {
      problems.push(
        `${e.sync}: fetched ${last.items_synced} at ${last.ran_at.slice(0, 16)}, ${e.table}` +
        (e.scopeWhere ? `[${e.scopeWhere}]` : '') + ` now holds ${held}`,
      );
    }
  }

  // A writer nobody declared is the gap this file is meant to close, so it is
  // named rather than left for a later audit to rediscover.
  const declared = new Set(ECHOES.map(e => e.sync));
  const writers = (db.prepare(`
    SELECT DISTINCT source FROM sync_log
    WHERE status = 'success' AND ran_at > ${isoNowSql("'-7 days'")}
  `).all() as Array<{ source: string }>).map(r => r.source);
  const undeclared = writers.filter(w => !declared.has(w) && !w.startsWith('check-') && !['completeness', 'scheduling', 'prune-logs'].includes(w));

  console.log(
    `[check-upstream-echo] ${checked} sync(s) compared, ${problems.length} mismatched, ` +
    `${voided.length} void, ${notComparable.length} not comparable, ` +
    `${undeclared.length} writer(s) undeclared`,
  );
  for (const p of problems) console.error(`  MISMATCH    ${p}`);
  for (const v of voided) {
    console.error(`  VOID        ${v}`);
    console.error('              log the count that came off the wire, not one read back out of the table');
  }
  for (const n of notComparable) console.log(`  n/a         ${n}`);
  if (undeclared.length) {
    console.log(`  undeclared  ${undeclared.length} sync(s) not in ECHOES: ${undeclared.slice(0, 12).join(', ')}`);
    console.log('              most are covered by check-completeness instead; add a line here for any that are not');
  }

  const failures = problems.length + voided.length;
  logRun('check-upstream-echo', {
    status: failures ? 'partial' : 'success',
    items: checked,
    error: failures ? [...problems, ...voided.map(v => `void ${v}`)].join(' ; ').slice(0, 1000) : undefined,
  }, db);

  if (failures) process.exitCode = 1;
}

main();
