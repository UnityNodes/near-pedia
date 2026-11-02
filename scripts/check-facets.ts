/**
 * Can the filter name everything the data holds?
 *
 * THE CLASS. A tool parameter that is an enum publishes a vocabulary. The
 * column behind it holds a vocabulary too. Nothing compared them, and they
 * drift in both directions:
 *
 *   HELD BUT NOT OFFERED   rows exist that no filter value can select. The
 *                          tool serves them when nobody filters, so this
 *                          reads as a working source right up until a
 *                          caller narrows.
 *   OFFERED BUT NOT HELD   a value the column has never contained. Passing
 *                          it returns "no matches", indistinguishable from
 *                          "this source is empty".
 *
 * WHY IT NEEDED ITS OWN CHECK. Whatever asks "does this tool's schema admit
 * the inputs it should" treats an enum as closed by construction and stops
 * there - that is true about the door and says nothing about whether the
 * door is in the right wall.
 *
 * THE TWO SIDES ARE INDEPENDENT. The enum comes from the schema the running
 * server publishes over HTTP (via a scratch instance against a snapshot of
 * the live data - lib/mcp-probe.ts), the values from the table the syncs
 * write. Where the values are not a column - search.type is produced in
 * lib/search.ts - the second side is that file, still a different file from
 * the one carrying the enum.
 *
 * A DIFFERENCE IS NOT AUTOMATICALLY A DEFECT, so each facet declares what is
 * allowed to differ and why (an `all` sentinel, an enum that isn't a data
 * facet at all). An undeclared difference fails.
 *
 * Not covered: a case-sensitive filter next to a case-insensitive "no match"
 * explanation, so a held value in another case returns an empty answer with
 * no reason. No nearpedia tool was found with that shape: list_ecosystem_projects' category filter has no separate
 * case-insensitive explanation to disagree with its case-sensitive `=`.
 *
 *   npx tsx scripts/check-facets.ts
 */

import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { repoPath } from '../lib/repo-root';
import { startScratchMcp } from '../lib/mcp-probe';

interface Facet {
  tool: string;
  param: string;
  /** What the enum is meant to select over, for the failure message. */
  surface: string;
  /** The values the data actually holds. null = not a data facet, skip. */
  held: ((db: Database.Database) => string[]) | null;
  /** Offered values that legitimately have no row, and why. */
  offeredWithoutRows?: Record<string, string>;
  /** Held values that legitimately have no enum entry, and why. */
  heldWithoutValue?: Record<string, string>;
  /** Why this facet is not compared at all. */
  why?: string;
}

const col = (sql: string) => (db: Database.Database): string[] =>
  (db.prepare(sql).all() as Array<Record<string, unknown>>)
    .map(r => String(Object.values(r)[0] ?? ''))
    .filter(v => v.trim() !== '');

/**
 * The types lib/search.ts can put on a result.
 *
 * Read from the SearchResultType union it exports, from the SOURCE rather
 * than imported: the zod enum this is compared against comes from the
 * running server, and importing the type here would make both sides of the
 * comparison one value that always agrees with itself.
 */
function searchResultTypes(): string[] {
  const src = fs.readFileSync(repoPath('lib', 'search.ts'), 'utf8');
  const m = src.match(/export type SearchResultType\s*=\s*([^;]+);/);
  if (!m) throw new Error('lib/search.ts no longer declares SearchResultType; this check cannot see the vocabulary');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

const FACETS: Facet[] = [
  {
    tool: 'semantic_search', param: 'source_types',
    surface: 'a source type in the embedding index',
    held: col('SELECT DISTINCT source_type FROM embedding_chunks ORDER BY 1'),
  },
  {
    tool: 'search', param: 'type',
    surface: 'a result type lib/search.ts can emit',
    held: () => searchResultTypes(),
    offeredWithoutRows: { all: 'the no-filter sentinel, not a type' },
  },
  {
    tool: 'search_github_issues', param: 'state',
    surface: 'a GitHub issue/PR state',
    held: col('SELECT DISTINCT state FROM github_items ORDER BY 1'),
    offeredWithoutRows: { all: 'the no-filter sentinel' },
  },
];

interface Problem { facet: string; kind: 'held-not-offered' | 'offered-not-held' | 'missing' | 'drift'; what: string }

async function main(): Promise<void> {
  const problems: Problem[] = [];
  const mcp = await startScratchMcp({ label: 'check-facets' });
  let compared = 0;
  const lines: string[] = [];

  try {
    const listed = await mcp.rpc('tools/list', {});
    const tools = ((listed.result as { tools?: Array<{ name: string; inputSchema?: Record<string, unknown> }> })?.tools) ?? [];
    const byName = new Map(tools.map(t => [t.name, t]));

    for (const f of FACETS) {
      const key = `${f.tool}.${f.param}`;
      const tool = byName.get(f.tool);
      if (!tool) {
        problems.push({ facet: key, kind: 'missing', what: 'the server publishes no such tool' });
        continue;
      }
      const props = (tool.inputSchema?.properties ?? {}) as Record<string, { enum?: string[]; items?: { enum?: string[] } }>;
      const p = props[f.param];
      if (!p) {
        problems.push({ facet: key, kind: 'missing', what: 'the server publishes no such parameter' });
        continue;
      }
      // Array-of-enum (source_types) carries the values on `items`.
      const offered = p.enum ?? p.items?.enum;
      if (!offered) {
        problems.push({ facet: key, kind: 'missing', what: 'the parameter is no longer an enum, so this facet publishes no vocabulary to compare' });
        continue;
      }

      if (!f.held) {
        lines.push(`  skip  ${key.padEnd(38)} ${f.why}`);
        continue;
      }

      compared++;
      const held = f.held(mcp.snapshot);
      const offeredSet = new Set(offered);
      const heldSet = new Set(held);

      for (const v of held) {
        if (offeredSet.has(v)) continue;
        if (f.heldWithoutValue?.[v]) continue;
        problems.push({
          facet: key, kind: 'held-not-offered',
          what: `"${v}" is ${f.surface} the data holds and this enum cannot name, so those rows are unreachable through the filter`,
        });
      }
      for (const v of offered) {
        if (heldSet.has(v)) continue;
        if (f.offeredWithoutRows?.[v]) continue;
        problems.push({
          facet: key, kind: 'offered-not-held',
          what: `"${v}" is offered but no row holds it, so asking for it returns an empty answer that reads as an empty source`,
        });
      }
      lines.push(`  ok    ${key.padEnd(38)} ${offered.length} offered / ${held.length} held`);
    }
  } finally {
    mcp.close();
  }

  for (const l of lines) console.log(l);
  for (const p of problems) console.error(`  [${p.kind}] ${p.facet}\n      ${p.what}`);

  const skipped = FACETS.filter(f => !f.held).length;
  logRun('facets', {
    status: problems.length ? 'error' : 'success',
    items: FACETS.length,
    error: problems.length
      ? `${problems.length} facet problem(s): ` + problems.slice(0, 3).map(p => `${p.facet} ${p.what.slice(0, 90)}`).join(' | ')
      : undefined,
  });

  console.log(
    problems.length
      ? `[check-facets] ${problems.length} problem(s) over ${FACETS.length} enum facets (${compared} compared, ${skipped} declared not-a-data-facet)`
      : `[check-facets] ${compared} of ${FACETS.length} enum facets name every value their data holds; ${skipped} declared not-a-data-facet`,
  );
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  main().catch(err => {
    console.error('check-facets failed:', err);
    logRun('facets', { status: 'error', error: String(err).slice(0, 500) });
    process.exit(1);
  });
}
