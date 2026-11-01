/**
 * Does a real agent actually succeed in calling our tools?
 *
 * WHY. Every other input check here generates its cases FROM a tool's own schema
 * - check-inputs sends what the schema admits, check-facets walks the enum,
 * check-callers checks OUR call sites. None of them can see what an EXTERNAL
 * agent actually sends, because that is the one thing a schema does not contain.
 * A tool whose parameter is named for our internal vocabulary rather than the
 * agent's would get rejected call after call, and the only witness is mcp_calls,
 * which no other check reads.
 *
 * WHAT IT REFUSES TO BECOME. A naive "tool has errors" check is red forever:
 * mcp_calls here is dominated by directory/registry crawlers and auth probes
 * (verifymcp, mcpbeat, SentinelOracle, ...) hitting tool names that never
 * existed, and a fixed historical spike would otherwise sit in the table
 * forever. So the scope is deliberately narrow, on the same reasoning as
 * check-writers-succeeding:
 *   - REGISTERED tools only (a name that has ever returned 'ok'). A name that
 *     only ever errored is a probe guessing a tool that does not exist -
 *     reported as a soft PHANTOM note, never as a tool failure.
 *   - A RECENT window, so a fixed historical spike says nothing about today.
 *   - A real volume+rate threshold, so one flaky call among many isn't noise.
 *
 * NO NON_AGENT EXCLUSION LIST. mcp_calls has exactly one writer (mcp-server.ts's
 * own request handler) and nearpedia has no internal component that calls its
 * own MCP endpoint over HTTP - every row here is a genuine external caller.
 *
 * NO "top failing shape" DIAGNOSTIC. nearpedia's mcp_calls schema (ts, method,
 * tool, source, status, duration_ms) does not capture call parameters at all,
 * so there is nothing to show beyond the tool name, count, and rate.
 *
 * Reads mcp_calls only: no network, no MCP calls, no rate limit. ~1s.
 *
 *   npx tsx scripts/check-agent-errors.ts
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { isoNowSql } from '../lib/formats';

const WINDOW_DAYS = 7;
const MIN_ERRORS = 5;   // enough real calls to be a signal, not a one-off
const ERROR_RATE = 0.4; // 40%+ of a registered tool's calls failing

function main(): void {
  const db = getDb();
  const since = isoNowSql(`'-${WINDOW_DAYS} days'`);

  // A tool that has ever succeeded is the real, registered surface.
  const registered = new Set(
    (db.prepare(`SELECT DISTINCT tool FROM mcp_calls WHERE status = 'ok'`).all() as Array<{ tool: string }>)
      .map(r => r.tool),
  );

  const rows = db.prepare(`
    SELECT tool, COUNT(*) AS calls, SUM(status != 'ok') AS errs
    FROM mcp_calls
    WHERE ts > ${since}
      AND tool NOT IN ('tools/list', 'tools/call', 'initialize')
    GROUP BY tool
  `).all() as Array<{ tool: string; calls: number; errs: number }>;

  const failing: string[] = [];
  const phantom: string[] = [];
  for (const r of rows) {
    if (!r.errs) continue;
    if (!registered.has(r.tool)) {
      // A plausible tool-name a caller guessed that this server never served.
      // Skip scanner shapes (__verifymcp_auth_probe_..., path traversal) - keep
      // real guesses, which are the tool-NAME half of the same affordance problem.
      if (/^[a-z][a-z0-9_]{2,}$/.test(r.tool) && !r.tool.startsWith('__')) {
        phantom.push(`${r.tool} (${r.errs} tr., no such tool)`);
      }
      continue;
    }
    const rate = r.errs / r.calls;
    if (r.errs >= MIN_ERRORS && rate >= ERROR_RATE) {
      failing.push(`${r.tool}: ${r.errs}/${r.calls} calls failed (${Math.round(rate * 100)}%)`);
    }
  }

  console.log(`[check-agent-errors] ${WINDOW_DAYS}d window: ${rows.length} tool(s) called, ${failing.length} failing, ${phantom.length} phantom name(s)`);
  for (const f of failing) console.error(`  FAILING   ${f}`);
  for (const p of phantom) console.warn(`  PHANTOM   ${p}`);

  logRun('check-agent-errors', {
    status: failing.length ? 'error' : 'success',
    items: rows.length,
    error: failing.join(' ; ').slice(0, 1000) || undefined,
  }, db);

  if (failing.length) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error('check-agent-errors failed:', err);
  logRun('check-agent-errors', { status: 'error', error: String(err).slice(0, 500) });
  process.exit(1);
}
