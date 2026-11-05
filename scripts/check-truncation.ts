/**
 * A body that was cut must say so, and say how much there was.
 *
 * Before this check existed, this app's serving layer had the exact bug
 * class it catches: get_doc cut doc_pages.content_text at a bare `.slice(0,40000)` with no
 * marker - doc id 205 is 99434 chars, so the tool (whose own description
 * says "Read the FULL text") served 40% of it silently. Fixed alongside
 * this check via lib/truncate.ts's cutForAnswer, which already existed and
 * was already used correctly by three other tools here
 * (get_issue_status/get_latest_release/get_sdk_changelog) - the gap was a
 * call site that never adopted it, not a missing mechanism.
 *
 * THE CLASS. The damage is not the missing text. It is that the agent
 * cannot tell a document that does not discuss X from a prefix that does
 * not reach X. It reads 40000 clean-looking characters, finds no mention of
 * something the doc actually covers past that point, and answers that the
 * page does not cover it. Nothing in the answer contradicts it, and no
 * other check looks: check-served asks whether a COLUMN reached the answer,
 * and it did; check-corpus-text asks about the STORED text, and the stored
 * text is whole - the cut happens only at serving time.
 *
 * WHAT THIS WALKS. Every cut site is declared below with the row that
 * provokes it. For each, the tool is called through a real MCP server with
 * the LONGEST row that source holds, and the answer must carry the marker
 * and the true length. A site whose data has nothing over the cap is
 * declared dormant, and the check says so rather than counting it as
 * covered: a cut nobody can reach today is still a cut, and it will bite
 * the day the corpus grows.
 *
 * The second half is cheaper and catches the regression that matters most:
 * a NEW cut added to the serving layer with no marker. Any `.slice(0, N)`
 * with N at or above BODY_CUT that is not on the declared list fails.
 *
 *   npx tsx scripts/check-truncation.ts
 */

import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { repoPath } from '../lib/repo-root';
import { stripJsComments } from '../lib/strip-comments';
import { startScratchMcp } from '../lib/mcp-probe';

/**
 * Below this, a slice is a field being formatted (an ISO date to 10 chars,
 * an id, a user-agent header), not a body being cut.
 */
const BODY_CUT = 600;

interface Site {
  where: string;
  tool: string;
  longest: (db: Database.Database) => { args: Record<string, unknown>; len: number } | null;
  cut: number;
  dormant?: string;
}

const one = <T>(db: Database.Database, sql: string): T | undefined => {
  try { return db.prepare(sql).get() as T; } catch { return undefined; }
};

const SITES: Site[] = [
  {
    where: 'get_doc doc_pages.content_text',
    tool: 'get_doc',
    cut: 40_000,
    longest: (db) => {
      const r = one<{ id: number; n: number }>(db, 'SELECT id, length(content_text) n FROM doc_pages ORDER BY n DESC LIMIT 1');
      return r ? { args: { id: r.id }, len: r.n } : null;
    },
  },
  {
    where: 'get_discussion forum_posts.cooked, per post',
    tool: 'get_discussion',
    cut: 2000,
    longest: (db) => {
      const r = one<{ topic_id: number; post_number: number; n: number }>(db, 'SELECT topic_id, post_number, length(cooked) n FROM forum_posts ORDER BY n DESC LIMIT 1');
      return r ? { args: { topic: r.topic_id, from_post: r.post_number }, len: r.n } : null;
    },
  },
  {
    where: 'get_github_discussion comments_json[].body, per comment',
    tool: 'get_github_discussion',
    cut: 800,
    longest: (db) => {
      const rows = (() => { try { return db.prepare('SELECT id, comments_json FROM github_discussions').all() as Array<{ id: string; comments_json: string | null }>; } catch { return []; } })();
      let best: { args: Record<string, unknown>; len: number } | null = null;
      for (const r of rows) {
        let cs: Array<{ body?: string }> = [];
        try { cs = r.comments_json ? JSON.parse(r.comments_json) : []; } catch { continue; }
        for (const c of cs) {
          const n = (c.body ?? '').length;
          if (!best || n > best.len) best = { args: { id: r.id }, len: n };
        }
      }
      return best;
    },
  },
  {
    where: 'get_issue_status github_items.body',
    tool: 'get_issue_status',
    cut: 2_000,
    longest: (db) => {
      const r = one<{ repo: string; number: number; n: number }>(db,
        'SELECT repo, number, length(body) n FROM github_items WHERE number IS NOT NULL ORDER BY n DESC LIMIT 1');
      return r ? { args: { repo: r.repo, number: r.number }, len: r.n } : null;
    },
  },
  {
    where: 'get_latest_release github_releases.body',
    tool: 'get_latest_release',
    cut: 2_000,
    longest: (db) => {
      // NOT simply "the newest-published release of a repo": the tool
      // filters to STABLE_TAG_RE (/^v?\d+(?:\.\d+){1,3}$/) first, then picks
      // the newest release of the highest major line among those. NEAR
      // repos interleave plain numbered tags (v0.31.4) with network-suffixed
      // ones (v0.32.1-testnet, v0.32.1-devnet) that are frequently NEWER by
      // published_at but never stable-tagged - a naive "newest published"
      // query provoked a node repo with a -testnet release the tool would
      // never actually serve, reporting a false "silent cut" against a body
      // (16662 chars) the tool cannot reach; the real served body (v0.31.4,
      // 589 chars total) was never cut at all. Falls back to the newest
      // release of any shape when a repo has no stable tag, matching the
      // tool's own fallback path.
      const STABLE = /^v?\d+(?:\.\d+){1,3}$/;
      const majorOf = (tag: string) => parseInt((tag.replace(/^v/, '').match(/^\d+/) ?? ['0'])[0], 10);
      const repos = (db.prepare('SELECT DISTINCT repo FROM github_releases').all() as { repo: string }[]).map(r => r.repo);
      let best: { args: Record<string, unknown>; len: number } | null = null;
      for (const repo of repos) {
        const all = db.prepare('SELECT tag, length(body) n FROM github_releases WHERE repo = ? ORDER BY published_at DESC').all(repo) as { tag: string; n: number }[];
        const stable = all.filter(r => STABLE.test(r.tag));
        const served = stable.length ? stable.find(r => majorOf(r.tag) === majorOf(stable[0].tag))! : all[0];
        if (served && (!best || served.n > best.len)) best = { args: { package: repo }, len: served.n };
      }
      return best;
    },
  },
  {
    where: 'get_sdk_changelog github_releases.body',
    tool: 'get_sdk_changelog',
    cut: 4_000,
    longest: (db) => {
      const r = one<{ tag: string; repo: string; n: number }>(db, 'SELECT tag, repo, length(body) n FROM github_releases ORDER BY n DESC LIMIT 1');
      return r ? { args: { version: r.tag, repo: r.repo }, len: r.n } : null;
    },
  },
];

/**
 * Cuts in the serving layer that are formatting or a deliberately-scoped
 * preview, not a body being lost. Each REST route below mirrors the fuller
 * MCP tool declared as a site above.
 */
const NOT_A_BODY: Array<{ n: number; why: string }> = [
  { n: 20_000, why: 'REST /api/v1/docs/:id, mirrored by the MCP get_doc site above' },
  { n: 2_000, why: 'REST /api/v1/discussions/:id post text, mirrored by get_discussion' },
];

async function main(): Promise<void> {
  const problems: Array<{ kind: string; what: string }> = [];
  const lines: string[] = [];

  // ── half 1: every declared cut announces itself on its longest row ─────────
  const mcp = await startScratchMcp({ label: 'check-truncation', callTimeoutMs: 60_000 });
  let provoked = 0;
  let dormant = 0;
  try {
    for (const s of SITES) {
      const target = s.longest(mcp.snapshot);
      if (!target) { problems.push({ kind: 'no-row', what: `${s.where}: could not find a row to point ${s.tool} at` }); continue; }
      if (target.len <= s.cut) {
        if (!s.dormant) {
          problems.push({ kind: 'undeclared-dormant', what: `${s.where}: nothing in the corpus exceeds ${s.cut} (longest is ${target.len}), so this site is never exercised. Declare it dormant or drop it.` });
        } else {
          dormant++;
          lines.push(`  dormant ${s.tool.padEnd(24)} longest ${target.len} < cut ${s.cut}: ${s.dormant}`);
        }
        continue;
      }
      const answer = await mcp.callTool(s.tool, target.args);
      provoked++;
      const marker = new RegExp(`\\[truncated at ${s.cut} of (\\d+) chars`);
      const m = answer.match(marker);
      if (!m) {
        problems.push({
          kind: 'silent-cut',
          what: `${s.where}: ${s.tool}(${JSON.stringify(target.args)}) cut a ${target.len}-char body at ${s.cut} and the answer never says so`,
        });
        continue;
      }
      if (Number(m[1]) <= s.cut) {
        problems.push({ kind: 'marker-without-size', what: `${s.where}: the marker names ${m[1]} chars, which is not more than the cut, so it cannot be the true length` });
        continue;
      }
      lines.push(`  ok      ${s.tool.padEnd(24)} cut ${String(s.cut).padStart(6)} of ${m[1]} chars, and says so`);
    }
  } finally {
    mcp.close();
  }

  // ── half 2: no undeclared body cut has been added ──────────────────────────
  const src = stripJsComments(fs.readFileSync(repoPath('mcp-server.ts'), 'utf8'));
  const declared = new Set<number>([...SITES.map(s => s.cut), ...NOT_A_BODY.map(x => x.n)]);
  const seen = new Set<number>();
  for (const m of src.matchAll(/\.slice\(\s*0\s*,\s*([0-9_]+)\s*\)/g)) {
    const n = Number(m[1].replace(/_/g, ''));
    if (n < BODY_CUT) continue;
    seen.add(n);
    if (declared.has(n)) continue;
    problems.push({
      kind: 'undeclared-cut',
      what: `mcp-server.ts cuts a body at ${n} chars and no site declares it; route it through cutForAnswer, or add it to NOT_A_BODY with a reason`,
    });
  }
  lines.push(`  ok      source                   ${seen.size} distinct body cut size(s) in the serving layer, all declared`);

  for (const l of lines) console.log(l);
  for (const p of problems) console.error(`  [${p.kind}] ${p.what}`);

  logRun('truncation', {
    status: problems.length ? 'error' : 'success',
    items: SITES.length,
    error: problems.length
      ? `${problems.length} truncation problem(s): ` + problems.slice(0, 3).map(p => `${p.kind} ${p.what.slice(0, 90)}`).join(' | ')
      : undefined,
  });

  console.log(
    problems.length
      ? `[check-truncation] ${problems.length} problem(s) over ${SITES.length} cut sites (${provoked} provoked, ${dormant} dormant)`
      : `[check-truncation] ${provoked} of ${SITES.length} cut sites provoked on their longest row and every one names the cut and the true length; ${dormant} declared dormant`,
  );
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  main().catch(err => {
    console.error('check-truncation failed:', err);
    try { logRun('truncation', { status: 'error', items: 0, error: String(err).slice(0, 1000) }); } catch { /* db down */ }
    process.exit(1);
  });
}
