/**
 * A stored counter beside the rows it counts.
 *
 * The mechanism is generic (PRAGMA-driven surface scan + a declared
 * classification + a live MCP probe on the worst-drift rows); DECLARED and
 * SERVED are app-specific and built from this app's own schema.
 *
 * WHY. forum_topics.reply_count is Discourse's own column and does not mean
 * "posts after the first" - it counts only posts that reply to a SPECIFIC
 * post, so a top-level answer never touches it. get_discussion here already
 * derives its "Replies:" figure from the posts actually held rather than
 * serving that column raw (present in this app's copy of the tool from the
 * start - checked, not assumed). The SERVED entries below exist so that
 * repair cannot quietly come undone.
 *
 * WHAT THIS FOUND BEFORE IT HAD SERVED ENTRIES TO WALK. All 29
 * categories here are off by exactly 1: categories.topic_count (Discourse's
 * own figure) undercounts forum_topics grouped by category_id by one row
 * every time, because Discourse excludes the auto-generated "About the X
 * category" topic from its own tally while sync-forum still syncs it as a
 * real row. This app RENDERS the column directly next to a
 * topic list (components/topic-filters.tsx's category badges), and a counter
 * rendered beside a list of topics is derived THERE. Fixed
 * lib/forum.ts's getCategories() to derive it from held rows instead of
 * the stored column, at the one call site.
 *
 * THE COUNTER IS NOT THE DEFECT. Upstream is entitled to its own definition
 * and we are entitled to store it. The defect is serving it as ours when we
 * hold the rows and could have counted them. That is the invariant here:
 *
 *   a counter we can derive from rows we hold is never served raw.
 *
 * Drift then stops mattering for what an agent or a reader sees, which is
 * why this check reports drift as information and fails only on the
 * serving half.
 *
 * The serving half uses the shared lib/mcp-probe.ts helper rather than a
 * hand-spawned child process (one less copy of the VACUUM INTO / health-poll
 * mechanism, and it honours DB_PATH for testing this check itself from
 * outside the live checkout).
 *
 *   npx tsx scripts/check-counters.ts
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { startScratchMcp } from '../lib/mcp-probe';

/** Names that read as "a count of something" and so must be declared below. */
const COUNTER_NAME = /count|_total$|^total|_num$|^num_/i;

/** Tables whose names are index/shadow artefacts, not content. */
const NOT_CONTENT = /_fts($|_)|_docsize|_idx$|_data$|_content$|_rowids$|_chunks/;

interface Derivable {
  kind: 'derivable';
  table: string;
  column: string;
  child: string;
  parentKey: string;
  childKey: string;
  childWhere?: string;
  shape: 'rows' | 'rows-minus-one';
  why: string;
}

interface Served {
  tool: string;
  label: string;
  sampleSql: string;
  truthSql: string;
  arg: string;
  argType: 'number' | 'string';
  why: string;
}

const SERVED: Served[] = [
  {
    tool: 'get_discussion', label: 'Replies', arg: 'id', argType: 'number',
    sampleSql: `SELECT id FROM forum_topics t
      ORDER BY ABS(COALESCE(reply_count,0) - MAX(0,(SELECT COUNT(*) FROM forum_posts p WHERE p.topic_id=t.id) - 1)) DESC
      LIMIT 12`,
    truthSql: `SELECT MAX(0,(SELECT COUNT(*) FROM forum_posts p WHERE p.topic_id=?) - 1) n`,
    why: 'the answer to "did anyone reply to this thread"',
  },
  {
    tool: 'get_discussion', label: 'Posts', arg: 'id', argType: 'number',
    sampleSql: `SELECT id FROM forum_topics t
      ORDER BY ABS(COALESCE(posts_count,0) - (SELECT COUNT(*) FROM forum_posts p WHERE p.topic_id=t.id)) DESC
      LIMIT 12`,
    truthSql: `SELECT (SELECT COUNT(*) FROM forum_posts p WHERE p.topic_id=?) n`,
    why: 'posts_count is served raw (not derived); this is a regression guard on how well it holds up, not a repair',
  },
];

interface UpstreamOnly {
  kind: 'upstream-only';
  table: string;
  column: string;
  wouldNeed: string;
  why: string;
}

interface UpstreamClaim {
  kind: 'upstream-claim';
  table: string;
  column: string;
  child: string;
  parentKey: string;
  childKey: string;
  childWhere?: string;
  shape: 'rows' | 'rows-minus-one';
  why: string;
  doNotDeriveBecause: string;
}

type Declared = Derivable | UpstreamOnly | UpstreamClaim;

const DECLARED: Declared[] = [
  {
    kind: 'derivable',
    table: 'forum_topics', column: 'posts_count',
    child: 'forum_posts', parentKey: 'id', childKey: 'topic_id', shape: 'rows',
    why: 'we sync every post of every topic, so the posts held are the count',
  },
  {
    kind: 'derivable',
    table: 'forum_topics', column: 'reply_count',
    child: 'forum_posts', parentKey: 'id', childKey: 'topic_id',
    childWhere: 'post_number > 1', shape: 'rows',
    why: 'a reply is a post after the opening one, and we hold the posts; Discourse counts only posts that reply to a specific post, which is a different question',
  },
  {
    kind: 'upstream-claim',
    table: 'categories', column: 'topic_count',
    child: 'forum_topics', parentKey: 'id', childKey: 'category_id', shape: 'rows',
    why: "Discourse's own per-category figure; every one of 29 categories undercounts forum_topics by exactly 1, because Discourse excludes the auto-generated \"About the X category\" topic from its own tally while sync-forum syncs it as a real row",
    doNotDeriveBecause:
      'the STORED column is left as Discourse\'s own claim on purpose - overwriting it would lose what upstream believes. '
      + 'What changed is the RENDER path: components/topic-filters.tsx shows this figure directly beside a list of topics, so '
      + 'lib/forum.ts\'s getCategories() (its one call site) now derives the count from held rows instead of reading this column - '
      + 'derived at the render site, not by rewriting what this column stores.',
  },
  {
    kind: 'derivable',
    table: 'github_discussions', column: 'comments_count',
    child: 'github_discussions', parentKey: 'id', childKey: 'id', shape: 'rows',
    childWhere: "json_valid(comments_json)",
    why: 'the comments are stored inline as comments_json on the same row; counted against its length below rather than a child table',
  },
  {
    kind: 'upstream-only',
    table: 'forum_topics', column: 'like_count',
    wouldNeed: 'a per-post like feed we trust as much as the topic figure',
    why: 'forum_posts.like_count is itself an upstream copy read at a different time, so neither side is an oracle for the other',
  },
  {
    kind: 'upstream-only',
    table: 'forum_posts', column: 'like_count',
    wouldNeed: 'the like events themselves, which Discourse does not publish per post in the listing',
    why: 'a leaf counter with no rows under it',
  },
  {
    kind: 'upstream-only',
    table: 'search_log', column: 'result_count',
    wouldNeed: 'the result rows of each past search, which are not retained',
    why: 'a log of what a query returned at the time, not a counter over stored rows',
  },
];

async function servingHalf(db: ReturnType<typeof getDb>, problems: string[], lines: string[]): Promise<void> {
  const mcp = await startScratchMcp({ label: 'check-counters' });
  try {
    for (const s of SERVED) {
      let ids: Array<Record<string, unknown>>;
      try { ids = db.prepare(s.sampleSql).all() as Array<Record<string, unknown>>; }
      catch (err) { problems.push(`${s.tool}/${s.label}: sample query failed (${(err as Error).message.slice(0, 70)})`); continue; }
      if (!ids.length) { problems.push(`${s.tool}/${s.label}: the sample query returned no rows, so nothing was graded`); continue; }

      let wrong = 0; let graded = 0; const worst: string[] = [];
      for (const row of ids) {
        const id = Object.values(row)[0];
        const answer = await mcp.callTool(s.tool, { [s.arg]: s.argType === 'number' ? Number(id) : String(id) });
        if (answer.startsWith(' rpc-error:')) { problems.push(`${s.tool}(${id}) errored: ${answer.slice(0, 120)}`); continue; }
        const m = new RegExp(String.raw`\b${s.label}:\s*(\d+)`).exec(answer);
        if (!m) { problems.push(`${s.tool}(${id}) printed no "${s.label}:" figure; the label moved and this check would grade nothing`); continue; }
        const truth = (db.prepare(s.truthSql).get(id) as { n: number }).n;
        graded++;
        if (Number(m[1]) !== truth) {
          wrong++;
          if (worst.length < 3) worst.push(`${s.arg}=${id} printed ${m[1]}, rows held say ${truth}`);
        }
      }

      if (wrong > 0) {
        problems.push(
          `${s.tool} printed a "${s.label}" figure that disagrees with the rows we hold on ${wrong} of ${graded} probe(s): ` +
          `${worst.join('; ')}. ${s.why}.`,
        );
      } else if (graded > 0) {
        lines.push(`  ok      ${`${s.tool} → ${s.label}`.padEnd(34)} matches the rows held on all ${graded} worst-drift probe(s)`);
      }
    }
  } finally {
    mcp.close();
  }
}

async function main(): Promise<void> {
  const db = getDb();
  const problems: string[] = [];
  const lines: string[] = [];

  const tables = (db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  ).all() as Array<{ name: string; sql: string | null }>)
    .filter((t) => !NOT_CONTENT.test(t.name))
    .filter((t) => !(t.sql && /USING\s+(vec0|fts5)/i.test(t.sql)));

  const found: string[] = [];
  for (const t of tables) {
    let cols: Array<{ name: string }>;
    try { cols = db.prepare(`PRAGMA table_info("${t.name}")`).all() as Array<{ name: string }>; }
    catch { continue; }
    for (const c of cols) if (COUNTER_NAME.test(c.name)) found.push(`${t.name}.${c.name}`);
  }

  const declaredKeys = new Set(DECLARED.map((d) => `${d.table}.${d.column}`));
  for (const key of found) {
    if (!declaredKeys.has(key)) {
      problems.push(
        `${key} is a counter no entry in check-counters declares. Say whether it can be recomputed ` +
        'from rows we hold, or what we would have to hold first.',
      );
    }
  }
  for (const d of DECLARED) {
    if (!found.includes(`${d.table}.${d.column}`)) {
      problems.push(`${d.table}.${d.column} is declared here but no longer exists; drop the entry or fix the name.`);
    }
  }

  for (const d of DECLARED) {
    if (d.kind !== 'derivable' && d.kind !== 'upstream-claim') continue;
    const where = d.childWhere ? ` AND ${d.childWhere}` : '';
    const minus = d.shape === 'rows-minus-one' ? ' - 1' : '';
    let drift: { total: number; off: number };
    try {
      if (d.table === 'github_discussions') {
        drift = db.prepare(`
          SELECT COUNT(*) total,
                 SUM(CASE WHEN comments_count <> json_array_length(comments_json) THEN 1 ELSE 0 END) off
          FROM github_discussions WHERE json_valid(comments_json)
        `).get() as { total: number; off: number };
      } else {
        drift = db.prepare(`
          SELECT COUNT(*) total, SUM(CASE WHEN stored <> held${minus} THEN 1 ELSE 0 END) off FROM (
            SELECT p."${d.column}" stored,
                   (SELECT COUNT(*) FROM "${d.child}" ch WHERE ch."${d.childKey}" = p."${d.parentKey}"${where}) held
            FROM "${d.table}" p WHERE p."${d.column}" IS NOT NULL
          )
        `).get() as { total: number; off: number };
      }
    } catch (err) {
      problems.push(`${d.table}.${d.column} cannot be recomputed (${(err as Error).message.slice(0, 70)}); the declaration says it is derivable`);
      continue;
    }
    const off = drift.off ?? 0;
    const pct = drift.total ? ((100 * off) / drift.total).toFixed(1) : '0.0';
    lines.push(
      d.kind === 'upstream-claim'
        ? `  claim   ${`${d.table}.${d.column}`.padEnd(34)} upstream's number, NOT to be derived; differs from rows held on ${off}/${drift.total} (${pct}%)`
        : `  ok      ${`${d.table}.${d.column}`.padEnd(34)} derived when served; stored figure differs from rows held on ${off}/${drift.total} (${pct}%)`,
    );
  }

  for (const d of DECLARED) {
    if (d.kind !== 'upstream-only') continue;
    lines.push(`  note    ${`${d.table}.${d.column}`.padEnd(34)} upstream-only: ${d.wouldNeed.slice(0, 60)}`);
  }

  await servingHalf(db, problems, lines);

  for (const l of lines) console.log(l);
  console.log(
    `[check-counters] ${found.length} counter column(s) on the surface, ` +
    `${DECLARED.filter((d) => d.kind === 'derivable').length} derivable, ` +
    `${DECLARED.filter((d) => d.kind === 'upstream-claim').length} upstream-claim, ` +
    `${DECLARED.filter((d) => d.kind === 'upstream-only').length} upstream-only, ` +
    `${SERVED.length} served figure(s) called, ${problems.length} problem(s)`,
  );

  for (const p of problems) console.error(`  BROKEN  ${p}`);
  if (problems.length) {
    console.error('  a counter we can recompute and serve raw hands the caller upstream\'s definition under our label');
  }

  logRun('check-counters', {
    status: problems.length ? 'partial' : 'success',
    items: found.length,
    error: problems.length ? problems.join(' ; ').slice(0, 1000) : undefined,
  }, db);

  if (problems.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  logRun('check-counters', { status: 'error', items: 0, error: String(err).slice(0, 1000) }, getDb());
  process.exitCode = 1;
});
