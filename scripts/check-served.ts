/**
 * A column a tool fetches must reach the answer, or be listed as not needed.
 *
 * WHY. Everything else asserted about this system is structural: the counts
 * match, the relationships hold, the totals mean what they say, the sources are
 * declared. All of that can pass while a tool selects the one field that
 * answers the question and drops it before printing.
 *
 * This has happened: a proposal getter lost approved_date, get_discussion lost
 * reply count/likes/source URL, and a deadlines tool fetched three columns
 * and printed none of them - the question, without the answer already in
 * hand while asking it.
 *
 * WHAT IT CANNOT DO is decide which columns matter. A join key, an internal id
 * and a sort field are all fetched and none belong in prose. That is the
 * judgement, so it is written down per tool rather than guessed, and the
 * default is that a fetched column is meant to be seen.
 *
 * Reads the first row-returning SELECT of each tool, which is where the
 * content lives; a tool whose later queries drop something is beyond this and
 * is not claimed otherwise.
 *
 *   npx tsx scripts/check-served.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';

/** Columns fetched for a reason other than being shown. */
const NOT_FOR_PRINT: Record<string, Record<string, string>> = {
  list_ecosystem_projects: { slug: 'url key, and the url itself is printed' },
  list_github_discussions: {
    number: 'the tail of the url, which is printed; the GraphQL node id is what get_github_discussion needs and that IS printed',
  },
  get_latest_release: {
    prerelease: 'read by latestStableByLine(), which only picks a release whose tag looks stable AND that GitHub does not flag as a prerelease, so the printed release is stable by construction; a newer tag with an unstable-looking shape is named in the printed "Note:" line',
  },
};

/** Names that are never content: counters, keys, SQL noise. */
const NOISE = new Set(['1', 'c', 'n', 'count', 'total', 'rowid', 'id', '*']);

/**
 * Blank out the TypeScript type of a query result before asking whether a
 * column is printed.
 *
 * A `.all(...) as Pick<XRow, 'id' | 'title' | ...>[]` cast names every
 * column it returns right after the SELECT, and a naive `\bcolumn\b` test
 * over everything after the SELECT would read every one of those as
 * "printed" - the annotation, not the prose, satisfying the match. This has
 * happened: the check went blind for weeks until this stripping
 * step existed, proven by planting a dropped column back in and getting
 * "0 drop something undeclared" regardless.
 */
function stripResultTypes(src: string): string {
  return src
    // Comments first. The test is a word match over source text, so a column
    // named in prose counts as printed. Block comments wholesale; line
    // comments only where `//` opens the line, because `https://` inside a
    // template literal is the same two characters and eating the rest of
    // THAT line would delete a real print.
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    // as Pick<XRow, 'a' | 'b'>[]  /  as Array<{ ... }>  /  as { ... }[]  /  as XRow | undefined
    .replace(/\bas\s+Pick<[^<>]*>(\s*\[\])?/g, ' as _T')
    .replace(/\bas\s+(?:Array|ReadonlyArray)<\{[\s\S]*?\}>/g, ' as _T')
    .replace(/\bas\s+\{[\s\S]*?\}(\s*\[\])?/g, ' as _T')
    .replace(/\bas\s+\w+Row(\s*\[\])?(\s*\|\s*undefined)?/g, ' as _T');
}

function main(): void {
  const src = fs.readFileSync(path.join(process.cwd(), 'mcp-server.ts'), 'utf-8');
  const blocks = src.split(/server\.tool\('/).slice(1);
  if (blocks.length === 0) throw new Error('check-served: found no tool registrations in mcp-server.ts');

  const problems: string[] = [];
  const staleNotes: string[] = [];
  let served = 0, exempted = 0, noQuery = 0;
  const seen = new Set<string>();

  for (const block of blocks) {
    const name = block.slice(0, block.indexOf("'"));
    seen.add(name);
    const body = block.slice(0, 9000);

    const m = /SELECT\s+((?:(?!FROM)[\s\S]){3,400}?)\s+FROM\s/i.exec(body);
    if (!m) { noQuery++; continue; }

    const cols = m[1]
      .split(',')
      .map(s => s.trim())
      .map(s => / as (\w+)$/i.exec(s)?.[1] ?? s)   // the alias is the name the code uses
      .map(s => s.replace(/^[a-z]+\./, ''))        // drop the table prefix
      .filter(s => /^\w+$/.test(s))
      .filter(s => !NOISE.has(s.toLowerCase()));
    if (cols.length === 0) { noQuery++; continue; }

    const after = stripResultTypes(body.slice(m.index + m[0].length));
    const declared = NOT_FOR_PRINT[name] ?? {};
    const dropped = cols.filter(c => !new RegExp(String.raw`\b${c}\b`).test(after));
    const undeclared = dropped.filter(c => !(c in declared));

    // A note for a column the tool now prints, or no longer fetches, is stale
    // bookkeeping, and stale bookkeeping is how the drop stayed invisible.
    for (const c of Object.keys(declared)) {
      if (!dropped.includes(c)) staleNotes.push(`${name}.${c} is listed as not-for-print but is rendered or no longer selected`);
    }

    if (undeclared.length) {
      problems.push(`${name} fetches ${undeclared.join(', ')} and never prints ${undeclared.length > 1 ? 'them' : 'it'}`);
    } else if (dropped.length) {
      exempted++;
    } else {
      served++;
    }
  }

  const staleTools = Object.keys(NOT_FOR_PRINT).filter(t => !seen.has(t));

  console.log(
    `[check-served] ${blocks.length} tools: ${served} print every column they fetch, ` +
    `${exempted} drop only declared ones, ${noQuery} fetch no columns, ${problems.length} drop something undeclared`,
  );
  for (const p of problems) {
    console.error(`  DROPPED     ${p}`);
    console.error('              print it, or list it in NOT_FOR_PRINT with what it is fetched for');
  }
  for (const s of staleNotes) console.error(`  STALE       ${s}`);
  for (const t of staleTools) console.error(`  STALE       NOT_FOR_PRINT names ${t}, which is not a tool`);

  const failures = problems.length + staleNotes.length + staleTools.length;
  logRun('check-served', {
    status: failures ? 'partial' : 'success',
    items: blocks.length,
    error: failures ? [...problems, ...staleNotes, ...staleTools].join(' ; ').slice(0, 1000) : undefined,
  }, getDb());

  if (failures) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error('check-served failed:', err);
  logRun('check-served', { status: 'error', error: String(err).slice(0, 500) });
  process.exit(1);
}
