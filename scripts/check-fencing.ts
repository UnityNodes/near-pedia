/**
 * A tool that shows what a stranger wrote must say so in the output.
 *
 * WHY. nearpedia hands forum posts, GitHub issue/discussion text, and
 * ecosystem self-listings to a model. Text in those tables was typed by
 * someone who is not the operator and who can address the model directly, so
 * it goes out wrapped in lib/untrusted-fence.ts markers or under a banner
 * that names it as data.
 *
 * WHAT MAKES IT MECHANICAL is the table list, and that list is a judgement
 * nothing in the schema can make. A release note was written by a
 * maintainer and is not fenced, because it went through the repository's
 * review; a forum title was written by a community member and is
 * fenced, because nothing stands between the keyboard and the corpus. The
 * difference is editorial control, not authorship, and it has to be stated.
 *
 *   npx tsx scripts/check-fencing.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';

/**
 * Tables holding text a stranger typed, with nothing between them and us.
 * Adding a table here is how a new source becomes covered.
 */
const UNTRUSTED_TABLES = [
  'forum_topics', 'forum_posts',              // anyone with a Discourse account
  'github_items', 'github_discussions',       // anyone with a GitHub account
  'ecosystem_projects',                       // project self-listings
  'radar_items',                              // derived from the above
  'youtube_videos',                           // channel-authored titles
];

/**
 * doc_pages spans multiple sources (docs.near.org, plus partner docs) and
 * its trust is decided per ROW by publisher
 * (lib/doc-trust.ts), so the table-level UNTRUSTED_TABLES list cannot
 * express it. Every tool whose body reads doc_pages must route its text
 * through a doc-trust helper - serveDocText for the body, docField for the
 * title/breadcrumb, or an isFirstPartyDoc gate - or record below WHY it
 * cannot surface a third-party page's text.
 */
const DOC_READ_EXEMPT: Record<string, string> = {};
const docHandlesTrust = (b: string): boolean =>
  /serveDocText\(|docField\(|isFirstPartyDoc\(/.test(b);

/** Tools that read an untrusted table and render none of its text. */
const AGGREGATE_ONLY: Record<string, string> = {
  list_repos:
    'renders repository names from github_items, which are paths in an org we index, not text a user wrote into a field',
};

const BANNER = /UNTRUSTED INPUT|UNTRUSTED_INLINE_LEGEND|marked untrusted|untrusted:|are public|community-submitted|self-listings|publicly-submitted/i;

/**
 * Every way lib/untrusted-fence.ts can be called, in ONE place. The `(?!\w)`
 * matters: `fenceUntrusted(` alone would not match `fenceUntrustedRun(`.
 */
const FENCE_CALL = /fenceUntrusted(Run|Inline)?\s*\(/;

/**
 * One tool per registration, bounded where its call closes at column zero.
 *
 * Splitting on the registration and keeping the rest of the text gives the LAST
 * tool in the file a body running to end of file — 63,347 characters against a
 * median of 2,669 in this tree. That tool then "reads" every table in the
 * schema, and any finding below it sits inside its block instead of in the
 * report: a check that says 0 unfenced over blocks it has mis-cut.
 *
 * Two other bounds were tried in the projects built from this template and both
 * were wrong. Cutting at the first line that closes a call cuts too early — a
 * handler contains `);` of its own, and a tool was reported unfenced with its
 * fence call forty lines below the boundary. Counting parentheses needs a lexer
 * this file defeats: regex literals and nested template expressions carry
 * brackets that are not brackets, and twelve blocks swallowed their neighbours.
 *
 * What holds without parsing is the layout — a registration starts at column
 * zero and closes with `);` or `});` at column zero, everything between
 * indented. The guard in main() is what makes that safe to rely on.
 */
function toolBlocks(src: string): string[] {
  const out: string[] = [];
  const CLOSE = /\n\}?\)\s*;/g;
  for (const m of src.matchAll(/^server\.tool\(\s*'[a-z0-9_]+'/gm)) {
    CLOSE.lastIndex = m.index!;
    const close = CLOSE.exec(src);
    const nextTool = src.indexOf('\nserver.tool(', m.index! + 1);
    out.push(src.slice(m.index!, Math.min(
      close ? close.index + close[0].length : src.length,
      nextTool > 0 ? nextTool : src.length,
    )));
  }
  return out;
}

/** The registered name, read back out of a block that still carries its call. */
const nameOf = (block: string): string => (/server\.tool\(\s*'([a-z0-9_]+)'/.exec(block) ?? [, ''])[1]!;

/**
 * Which untrusted tables each exported helper reads.
 *
 * Almost no tool writes its own SQL: the queries live in lib/search.ts,
 * lib/forum.ts, lib/code.ts, lib/ecosystem.ts and their neighbours, and the
 * tool calls a function. Matching `FROM <table>` inside the registration alone
 * sees a fraction of the real reads and counts the rest as "reads none" — in
 * one project built from this template, 8 readers found out of 18.
 *
 * One level of indirection, and deliberately coarse: a helper is credited with
 * every untrusted table named anywhere in its body. Over-approximating means a
 * tool can be asked to justify a read it does not really make, answered by a
 * line in AGGREGATE_ONLY. Under-approximating means silence.
 */
function helperTables(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const dir = path.join(process.cwd(), 'lib');
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue;
    const lib = fs.readFileSync(path.join(dir, file), 'utf-8');
    const marks = [...lib.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/g)];
    for (let i = 0; i < marks.length; i++) {
      const body = lib.slice(marks[i].index!, i + 1 < marks.length ? marks[i + 1].index! : lib.length);
      const tables = UNTRUSTED_TABLES.filter(t =>
        new RegExp(String.raw`FROM\s+${t}\b|JOIN\s+${t}\b`).test(body));
      if (tables.length) out.set(marks[i][1], [...new Set([...(out.get(marks[i][1]) ?? []), ...tables])]);
    }
  }
  return out;
}

function main(): void {
  const src = fs.readFileSync(path.join(process.cwd(), 'mcp-server.ts'), 'utf-8');
  const blocks = toolBlocks(src);
  if (blocks.length === 0) throw new Error('check-fencing: found no tool registrations in mcp-server.ts');
  // A bound that runs past its own call would put a neighbour's fence inside
  // this tool's block and report it as covered. Both directions are failures of
  // the reader, not of the server, so they stop the run rather than colour it.
  const spilled = blocks.filter(b => (b.match(/server\.tool\(\s*'/g) ?? []).length !== 1);
  if (spilled.length) throw new Error(`check-fencing: ${spilled.length} block(s) span more than one registration — the bound is wrong, not the server`);
  const viaHelper = helperTables();

  const problems: string[] = [];
  const staleExemptions: string[] = [];
  const seen = new Set<string>();
  let fenced = 0, exempt = 0, untouched = 0;

  let docFenced = 0, docExempt = 0;
  for (const block of blocks) {
    if (!/FROM\s+doc_pages\b|JOIN\s+doc_pages\b/.test(block)) continue;
    const name = nameOf(block);
    if (docHandlesTrust(block)) { docFenced++; continue; }
    if (name in DOC_READ_EXEMPT) { docExempt++; continue; }
    problems.push(`${name}: reads doc_pages and renders it without a doc-trust helper (serveDocText/docField/isFirstPartyDoc) nor is listed in DOC_READ_EXEMPT; a third-party page's title or body would be served as a trusted primary source`);
  }
  for (const n of Object.keys(DOC_READ_EXEMPT)) {
    const block = blocks.find(b => nameOf(b) === n);
    if (!block || !/FROM\s+doc_pages\b|JOIN\s+doc_pages\b/.test(block)) {
      staleExemptions.push(`DOC_READ_EXEMPT names ${n}, which no longer reads doc_pages (stale exemption)`);
    }
  }

  for (const block of blocks) {
    const name = nameOf(block);
    seen.add(name);
    const body = block;

    const direct = UNTRUSTED_TABLES.filter(t =>
      new RegExp(String.raw`FROM\s+${t}\b|JOIN\s+${t}\b`).test(body));
    const indirect = [...viaHelper]
      .filter(([fn]) => new RegExp(String.raw`\b${fn}\s*\(`).test(body))
      .flatMap(([, tbls]) => tbls);
    const reads = [...new Set([...direct, ...indirect])];
    if (reads.length === 0) { untouched++; continue; }

    if (name in AGGREGATE_ONLY) {
      if (FENCE_CALL.test(body)) {
        staleExemptions.push(`${name} is exempt as aggregate-only but now fences, so it renders content`);
      } else {
        exempt++;
      }
      continue;
    }

    if (FENCE_CALL.test(body) || BANNER.test(body)) { fenced++; continue; }
    problems.push(`${name} reads ${reads.join(', ')} and neither fences nor banners it`);
  }

  const staleNames = Object.keys(AGGREGATE_ONLY).filter(n => !seen.has(n));

  console.log(
    `[check-fencing] ${blocks.length} tools: ${fenced} fence untrusted content, ` +
    `${exempt} read it without rendering it, ${untouched} read none, ${problems.length} unfenced`,
  );
  console.log(
    `[check-fencing] doc publisher-trust: ${docFenced} route doc_pages text through doc-trust, ` +
    `${docExempt} exempt`,
  );
  for (const p of problems) {
    console.error(`  UNFENCED    ${p}`);
    console.error('              wrap it with fenceUntrusted, or add it to AGGREGATE_ONLY with what it renders instead');
  }
  for (const s of staleExemptions) console.error(`  STALE       ${s}`);
  for (const n of staleNames) console.error(`  STALE       AGGREGATE_ONLY names ${n}, which is not a tool`);

  const failures = problems.length + staleExemptions.length + staleNames.length;
  logRun('check-fencing', {
    status: failures ? 'partial' : 'success',
    items: blocks.length,
    error: failures ? [...problems, ...staleExemptions, ...staleNames].join(' ; ').slice(0, 1000) : undefined,
  }, getDb());

  if (failures) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error('check-fencing failed:', err);
  logRun('check-fencing', { status: 'error', error: String(err).slice(0, 500) });
  process.exit(1);
}
