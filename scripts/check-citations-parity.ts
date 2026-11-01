/**
 * The two roads to a CIP's mentions must give the same answer.
 *
 * Covers the mentions road only: get_cip_mentions and its REST twin
 * /api/v1/cips/:id/mentions.
 *
 * THE CLASS. mcp-server.ts is one process serving two publics: the MCP
 * tools at /mcp and a REST mirror at /api/v1/*. Both read one dataset
 * through separate code, and nothing compared them.
 *
 * Found before this check had anything to run against: /api/v1/cips/:id/
 * mentions used LIMIT 8/8/12 (forum/blog/other_cips) with no github_items
 * dimension at all, while get_cip_mentions has always used 5/5/5/8
 * (forum/blog/github_items/other_cips) INCLUDING github_items. Two
 * defects, not one: a well-cited CIP could show different row counts on
 * the two roads even where both dimensions existed, and any CIP mentioned
 * in a GitHub issue or PR was invisible on the REST road entirely. Fixed
 * alongside this check by aligning REST's caps and dimensions to the MCP
 * tool's exactly, rather than left broken with a check pointed at two
 * roads that could not agree by construction.
 *
 * THE ORACLE IS ROAD-TO-ROAD, not a reimplementation. For a batch spanning
 * the id-form space - padded, unpadded, CIP-prefixed, a PR-alias id, a bare
 * number that is a PR and not a CIP, a number that exists nowhere - the
 * REST answer and the MCP answer must agree on:
 *   - found vs not-found (a 404 on one road and a hit on the other is the defect)
 *   - the resolved canonical id
 *   - every per-source count get_cip_mentions prints
 *
 * Runs against a VACUUM INTO copy served by a second MCP instance (shared
 * startScratchMcp), so prod's limiter is untouched.
 *
 *   npx tsx scripts/check-citations-parity.ts
 *   npx tsx scripts/check-citations-parity.ts --verbose
 */

import { startScratchMcp } from '../lib/mcp-probe';
import { logRun } from '../lib/sync-log';
import { getDb } from '../lib/db';

const VERBOSE = process.argv.includes('--verbose');

// A batch chosen to exercise the resolver on both roads, not to be
// exhaustive: forms of well-cited CIPs, a PR-alias id, a bare number that
// resolves nowhere, an id that exists nowhere.
const IDS = ['0001', '1', 'CIP-0001', '0042', '42', 'CIP-0042', '0050', 'CIP-0050', '0000', '99999'];

const lastIntInParens = (heading: string): number => {
  const m = heading.match(/\(([^)]*)\)/);
  if (!m) return 0;
  const ints = m[1].match(/\d+/g);
  return ints ? parseInt(ints[ints.length - 1], 10) : 0;
};
const sectionTotal = (text: string, heading: string): number => {
  const line = text.split('\n').find(l => l.startsWith(`## ${heading}`));
  return line ? lastIntInParens(line) : 0; // absent section = 0 mentions
};
const citHeaderId = (text: string): string | null => {
  const m = text.match(/^#\s+CIP-([^\s:]+):/m);
  return m ? m[1] : null;
};

function eq(a: unknown, b: unknown): boolean { return a === b; }

async function main(): Promise<void> {
  const problems: string[] = [];
  const record = (msg: string) => problems.push(msg);
  let examined = 0;

  const mcp = await startScratchMcp({ label: 'check-citations-parity' });
  try {
    const base = `http://127.0.0.1:${mcp.port}`;

    for (const id of IDS) {
      examined++;

      const rMenRes = await fetch(`${base}/api/v1/cips/${encodeURIComponent(id)}/mentions`);
      const rMen = rMenRes.ok ? (await rMenRes.json()) as { cip_id: string; counts: Record<string, number> } : null;
      const mMen = await mcp.callTool('get_cip_mentions', { id });
      const mMenFound = /^#\s+CIP-/m.test(mMen);
      const rMenFound = rMenRes.status === 200;

      if (rMenFound !== mMenFound) {
        record(`${id}: mentions found-state disagrees - REST ${rMenRes.status} (${rMenFound ? 'found' : 'not found'}) vs MCP ${mMenFound ? 'found' : 'not found'}`);
        continue;
      }
      if (!rMenFound || !rMen) continue;

      const mId = citHeaderId(mMen);
      if (!eq(rMen.cip_id, mId)) record(`${id}: mentions resolved to different ids - REST "${rMen.cip_id}" vs MCP "${mId}"`);

      const secs: [string, string][] = [
        ['forum', 'Forum threads'], ['blog', 'Blog posts'],
        ['github_items', 'GitHub issues/PRs'], ['other_cips', 'Other CIPs'],
      ];
      for (const [key, heading] of secs) {
        const mVal = sectionTotal(mMen, heading);
        const rVal = rMen.counts?.[key] ?? 0;
        if (!eq(mVal, rVal)) record(`${id}: mentions "${key}" disagrees - REST ${rVal} vs MCP ${mVal}`);
      }
      if (VERBOSE) console.error(`    ${id}: mentions counts REST ${JSON.stringify(rMen.counts)}`);
    }
  } finally {
    mcp.close();
  }

  console.log(`[check-citations-parity] ${examined} id form(s) compared across both roads; ${problems.length} disagreement(s)`);
  for (const p of problems) console.error(`  DISAGREE  ${p}`);

  logRun('check-citations-parity', {
    status: problems.length ? 'error' : 'success',
    items: examined,
    error: problems.join(' ; ').slice(0, 1000) || undefined,
  }, getDb());

  if (problems.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  logRun('check-citations-parity', { status: 'error', items: 0, error: String(err).slice(0, 1000) }, getDb());
  process.exitCode = 1;
});
