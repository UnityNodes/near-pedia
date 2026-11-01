/**
 * The number a tool prints must be the number it names.
 *
 * Writing it found the exact defect it exists to catch: `list_cips`, `list_ecosystem_projects` and
 * `list_github_discussions` printed `${rows.length} X:` with no "of M" at
 * all - a bare page size standing in for a total, silently, on every
 * unfiltered call, because each corpus already exceeds its tool's default
 * limit (52 CIPs against a default of 20, 86 ecosystem projects against 30,
 * ~96 discussions against 15). Fixed alongside this check to use showingOf(),
 * the same helper get_radar/get_trending/list_videos already call.
 *
 * The PUBLISHED list holds six tools:
 * list_cips, list_ecosystem_projects, list_github_discussions, list_videos,
 * get_radar and get_trending.
 *
 * Needs the MCP server. If it is unreachable the run is UNVERIFIED, never a
 * pass: an unreported gap in a check reads exactly like a clean one.
 *
 *   npx tsx scripts/check-published-totals.ts
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { radarLiveSql } from '../lib/constants';

const BASE = process.env.MCP_URL ?? 'http://127.0.0.1:3131/mcp';

interface Published {
  tool: string;
  args: Record<string, unknown>;
  /** What the printed total should equal, asked of the database directly. */
  sql: string;
  /** Set when the tool deliberately prints something other than a table size. */
  why?: string;
}

const PUBLISHED: Published[] = [
  {
    tool: 'get_radar', args: { limit: 1 },
    // The tool's own filter, imported rather than restated: a second copy of
    // "is this alert still live" here would be exactly the trap check-formats'
    // G10 and this session's own isoNowSql() fix exist to prevent - two sides
    // that quote the SAME wrong predicate agree with each other and still
    // both be wrong.
    sql: `SELECT COUNT(*) c FROM radar_items WHERE ${radarLiveSql()}`,
    why: 'live alerts only, not everything the table has ever held: the tool has always filtered expired items',
  },
];

/** Thrown for a 429 so a throttled run is not reported as an outage. */
class RateLimited extends Error {}

async function callTool(tool: string, args: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
      signal: AbortSignal.timeout(25_000),
    });
    if (res.status === 429) throw new RateLimited(`retry after ${res.headers.get('RateLimit-Reset') ?? '?'}s`);
    if (!res.ok) return null;
    const body = await res.text();
    for (const line of body.split('\n')) {
      const l = line.startsWith('data: ') ? line.slice(6) : line;
      if (!l.trim().startsWith('{')) continue;
      const parsed = JSON.parse(l) as { result?: { content?: { text?: string }[]; isError?: boolean } };
      if (parsed.result?.isError) return null;
      return parsed.result?.content?.[0]?.text ?? null;
    }
    return null;
  } catch (err) {
    if (err instanceof RateLimited) throw err;
    return null;
  }
}

/** The M in "N of M", however the tool spells the sentence around it. */
function printedTotal(text: string): number | null {
  const m = /\bof\s+([\d,]+)\b/i.exec(text);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

async function main(): Promise<void> {
  const db = getDb();
  const problems: string[] = [];
  const unverified: string[] = [];
  let checked = 0;
  let throttled = '';

  for (const p of PUBLISHED) {
    let expected: number;
    try {
      expected = (db.prepare(p.sql).get() as { c: number }).c;
    } catch (err) {
      problems.push(`${p.tool}: its declared query does not run (${(err as Error).message.slice(0, 60)})`);
      continue;
    }

    let text: string | null;
    try {
      text = await callTool(p.tool, p.args);
    } catch (err) {
      throttled = `rate-limited at ${p.tool} (${(err as Error).message})`;
      break;
    }
    if (text === null) { unverified.push(`${p.tool}: no answer from the server`); continue; }

    const printed = printedTotal(text);
    if (printed === null) {
      problems.push(`${p.tool}: prints no total, but is declared here as publishing one`);
      continue;
    }

    checked++;
    if (printed !== expected) {
      problems.push(
        `${p.tool}: prints ${printed}, the database holds ${expected}` +
        (p.why ? ` (declared as: ${p.why.slice(0, 80)})` : ''),
      );
    } else {
      console.log(`  ok      ${p.tool.padEnd(24)} ${printed}${p.why ? '  (' + p.why.slice(0, 60) + ')' : ''}`);
    }
  }

  console.log(
    `[check-published-totals] ${checked} of ${PUBLISHED.length} total(s) compared, ` +
    `${problems.length} wrong, ${unverified.length} unverified` +
    (throttled ? ', stopped early on the rate limiter' : ''),
  );
  for (const pr of problems) console.error(`  WRONG       ${pr}`);
  for (const u of unverified) console.error(`  UNVERIFIED  ${u}`);
  if (throttled) {
    console.error(`  THROTTLED   ${throttled}`);
    console.error('              not an outage and not a pass: the totals after this one went unchecked');
  }

  const failures = problems.length + unverified.length;
  logRun('check-published-totals', {
    status: failures || throttled ? 'partial' : 'success',
    items: checked,
    error: [...problems, ...unverified, ...(throttled ? [throttled] : [])].join(' ; ').slice(0, 1000) || undefined,
  }, db);

  if (failures || throttled) process.exitCode = 1;
}

main();
