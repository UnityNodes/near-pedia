/**
 * Is the site actually running the commit this checkout is on?
 *
 * Nothing answered that before this. `/api/health` published a hardcoded
 * version literal, and the only way to tell which commit was live was to
 * remember it by hand across deploys.
 *
 * It is not a failure for prod to sit behind HEAD. Syncs and standing checks
 * run from the working tree through tsx, so a scripts-only commit is live the
 * moment it lands and needs no build at all. What matters is WHICH files
 * differ: if the gap touches app/, components/ or mcp-server.ts, the running
 * site is not serving the code in this checkout and somebody should know.
 *
 * So the check is specific rather than strict:
 *   same commit                          ok
 *   behind, scripts and docs only        ok, and says how far
 *   behind, and app/ or the server moved  FAILS, names the files
 *
 *   npx tsx scripts/check-deployed.ts
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { sourceFiles, reachableFrom, isNextEntry } from '../lib/reachability';

// Loopback, not the public host. The commit hash is served to local callers
// only (app/api/health/route.ts), and asking through Caddy makes the answer
// depend on whether a forwarding header survived the hop - which is a
// question about the proxy, not about the deploy this check is grading.
const BASE = process.env.HEALTH_URL ?? 'http://127.0.0.1:3040/api/health';
const MCP_HEALTH = process.env.MCP_HEALTH_URL ?? 'http://127.0.0.1:3041/health';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/**
 * TWO SERVICES, TWO SIGNALS. This is one rule now and it used to be one rule
 * for both, which made it wrong for one of them.
 *
 * The Next app is built, and /api/health reports the commit baked at build
 * time. mcp-server.ts is NOT built: it runs from source through tsx, so a
 * restart is the entire deploy. Judging it by the Next build's commit reports
 * the MCP server as stale minutes after it was restarted with the very
 * change in question, which is a check crying wolf about work already done.
 *
 * lib/ appears in both because both import it.
 */
const NEEDS_BUILD = /^(app\/|components\/|lib\/|middleware\.ts$|next\.config\.ts$|package\.json$)/;
const NEEDS_MCP_RESTART = /^(mcp-server\.ts$|lib\/)/;

/**
 * Config the bundler reads whatever the import graph says. Kept as a list so
 * the reachability filter below cannot argue with it.
 */
const ALWAYS_BUILD = new Set(['package.json', 'next.config.ts', 'middleware.ts', 'tsconfig.json']);

/**
 * A changed file only owes a rebuild if something served actually imports it.
 *
 * The prefix above is a good first cut and a bad verdict: a lib/ file
 * imported only by check scripts, and never by anything the site serves,
 * owes no build. Reported as STALE BUILD that would make this check red for
 * a difference that does not exist, which is how a check stops being read.
 *
 * Nothing is dropped. A changed file the graph cannot reach is printed on
 * its own line, so a walker that under-resolves an import shows up as a
 * surprise rather than as silence.
 */
function reachability(): { next: Set<string>; mcp: Set<string>; nextEntries: number; files: number } {
  const all = sourceFiles(ROOT);
  const rel = (p: string) => p.slice(ROOT.length + 1);
  const nextEntryFiles = all.filter((p) => isNextEntry(rel(p)));
  const next = reachableFrom(nextEntryFiles, ROOT);
  const mcp = reachableFrom(all.filter((p) => rel(p) === 'mcp-server.ts'), ROOT);
  return {
    next: new Set([...next].map(rel)),
    mcp: new Set([...mcp].map(rel)),
    nextEntries: nextEntryFiles.length,
    files: all.length,
  };
}

/**
 * Below this, the entry scan has stopped recognising Next's file conventions
 * and the graph is too small to decide anything. A collapsed graph would
 * quietly reclassify every stale file as "nothing imports it", which is the
 * one failure this check must not have - so the size is published on every
 * run and asserted here rather than trusted.
 */
const MIN_NEXT_ENTRIES = 40;

/**
 * The MCP side has one entry point, so a collapsed graph there shows up as a
 * count of 1 rather than as an error. Import specifiers in mcp-server.ts name
 * the EMITTED file ('./lib/search.js'); a resolver that looks for
 * search.js.ts instead reaches nothing behind those imports.
 */
const MIN_MCP_MODULES = 20;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

async function main(): Promise<void> {
  const head = git(['rev-parse', 'HEAD']);

  let deployed: string | null = null;
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`health ${res.status}`);
    const body = await res.json() as { build_commit?: string | null };
    deployed = body.build_commit ?? null;
  } catch (err) {
    console.error(`[check-deployed] UNVERIFIED: ${BASE} did not answer (${(err as Error).message.slice(0, 80)})`);
    logRun('check-deployed', { status: 'partial', items: 0, error: 'health endpoint unreachable' }, getDb());
    process.exitCode = 1;
    return;
  }

  if (!deployed) {
    // A build made before this field existed, or one where git was unreadable.
    // Reported, never assumed to match.
    console.error('[check-deployed] UNVERIFIED: the running build reports no commit; rebuild to populate it');
    logRun('check-deployed', { status: 'partial', items: 0, error: 'running build reports no commit' }, getDb());
    process.exitCode = 1;
    return;
  }

  // The MCP server answers for itself. Unreachable or silent about its commit
  // is UNVERIFIED, never assumed current: the reason this split exists is
  // that one service was being judged by another's number.
  let mcpCommit: string | null = null;
  let mcpNote = '';
  try {
    const res = await fetch(MCP_HEALTH, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`health ${res.status}`);
    const body = await res.json() as { commit?: string | null };
    mcpCommit = body.commit || null;
    if (!mcpCommit) mcpNote = 'the MCP server reports no commit; restart it to populate the field';
  } catch (err) {
    mcpNote = `the MCP server did not answer (${(err as Error).message.slice(0, 60)})`;
  }

  const filesBetween = (from: string): string[] => {
    try { return git(['diff', '--name-only', `${from}..HEAD`]).split('\n').filter(Boolean); }
    catch { return []; }
  };

  // A REHEARSAL SEAM, and the only one in this file.
  //
  // The diff this check classifies is deployed..HEAD, so right after a deploy
  // it is empty - and a control that makes a file reachable has nothing to
  // observe. CHECK_DEPLOYED_BASE moves the comparison base and nothing else:
  // it cannot turn a real failure into a pass, only widen what is compared. A
  // run under it announces itself and writes no sync_log row, because
  // check-oracles reads the last recorded run and a rehearsal is not one.
  const rehearsalBase = process.env.CHECK_DEPLOYED_BASE?.trim() || null;
  if (rehearsalBase) {
    console.log(`[check-deployed] REHEARSAL: comparing against ${rehearsalBase.slice(0, 12)} instead of the running build; nothing will be recorded`);
  }
  const compareFrom = rehearsalBase ?? deployed;
  const nextChanged = compareFrom === head ? [] : filesBetween(compareFrom);
  const reach = reachability();
  const servedByNext = (f: string) => ALWAYS_BUILD.has(f) || reach.next.has(f);
  const staleBuilt = nextChanged.filter(f => NEEDS_BUILD.test(f) && servedByNext(f));
  const unreachedBuild = nextChanged.filter(f => NEEDS_BUILD.test(f) && !servedByNext(f));

  const mcpBase = rehearsalBase ?? mcpCommit;
  const mcpChanged = mcpBase && mcpBase !== head ? filesBetween(mcpBase) : [];
  const staleMcp = mcpChanged.filter(f => NEEDS_MCP_RESTART.test(f) && reach.mcp.has(f));
  const unreachedMcp = mcpChanged.filter(f => NEEDS_MCP_RESTART.test(f) && !reach.mcp.has(f));

  const behind = deployed === head ? '0' : (() => {
    try { return git(['rev-list', '--count', `${deployed}..HEAD`]); } catch { return '?'; }
  })();

  console.log(
    `[check-deployed] graph: ${reach.nextEntries} Next entry point(s) reach ${reach.next.size} of ${reach.files} module(s); ` +
    `mcp-server.ts reaches ${reach.mcp.size}`,
  );
  console.log(
    `[check-deployed] site ${deployed.slice(0, 7)}${deployed === head ? ' (= HEAD)' : ` vs HEAD ${head.slice(0, 7)}, ${behind} ahead`}, ` +
    `mcp ${mcpCommit ? mcpCommit.slice(0, 7) + (mcpCommit === head ? ' (= HEAD)' : '') : 'unknown'}`,
  );

  const problems: string[] = [];
  // The walker and git must find the same entry points.
  const gitEntries = (() => {
    try {
      return git(['ls-files', 'app/**/*.ts', 'app/**/*.tsx', 'middleware.ts', 'next.config.ts'])
        .split('\n').filter(Boolean).filter((f) => isNextEntry(f));
    } catch { return null; }
  })();
  if (gitEntries === null) {
    console.error('  UNVERIFIED     git could not list the app tree, so the entry scan was not cross-checked');
  } else {
    const walked = new Set(sourceFiles(ROOT).map((p) => p.slice(ROOT.length + 1)).filter(isNextEntry));
    const invisible = gitEntries.filter((f) => !walked.has(f));
    if (invisible.length) {
      for (const f of invisible.slice(0, 8)) console.error(`  INVISIBLE      ${f} is an entry point git tracks and the walker never saw`);
      problems.push(`${invisible.length} entry point(s) git tracks are invisible to sourceFiles(): ${invisible.slice(0, 5).join(', ')}`);
    }
  }

  if (reach.mcp.size < MIN_MCP_MODULES) {
    console.error(`  UNVERIFIED     mcp-server.ts reaches only ${reach.mcp.size} module(s); its imports are not resolving`);
    problems.push(`mcp-server.ts reaches ${reach.mcp.size} module(s), below the ${MIN_MCP_MODULES} it imports: resolveImport no longer follows its specifiers`);
  }
  if (reach.nextEntries < MIN_NEXT_ENTRIES) {
    console.error(`  UNVERIFIED     only ${reach.nextEntries} Next entry point(s) found; the import graph is too small to classify anything`);
    problems.push(`entry scan found ${reach.nextEntries} Next entry point(s), below the ${MIN_NEXT_ENTRIES} this repo has: isNextEntry no longer matches Next's file conventions`);
  }
  if (staleBuilt.length) {
    for (const f of staleBuilt) console.error(`  STALE BUILD    ${f}`);
    console.error('                 the site is not serving these; rebuild and restart yourpedia');
    problems.push(`${staleBuilt.length} built file(s) newer than the running build: ${staleBuilt.slice(0, 8).join(', ')}`);
  } else if (nextChanged.length) {
    // Scripts and docs only: cron runs those from the working tree via tsx,
    // so they are already live and no build is owed.
    console.log(`  ok   ${nextChanged.length} file(s) changed since the build, none of them built`);
  }

  // Never silent: a file the graph could not reach is printed, so an import
  // the walker fails to resolve reads as a surprise rather than as agreement.
  if (unreachedBuild.length || unreachedMcp.length) {
    const both = [...new Set([...unreachedBuild, ...unreachedMcp])];
    console.log(`  ok   ${both.length} changed file(s) under a build-owing path that nothing served imports:`);
    for (const f of both) console.log(`         ${f}`);
  }

  if (staleMcp.length) {
    for (const f of staleMcp) console.error(`  STALE MCP      ${f}`);
    console.error('                 no build needed; restart yourpedia-mcp and it re-reads the source');
    problems.push(`${staleMcp.length} file(s) newer than the running MCP server: ${staleMcp.slice(0, 8).join(', ')}`);
  }
  if (mcpNote) {
    console.error(`  UNVERIFIED     ${mcpNote}`);
    problems.push(mcpNote);
  }

  if (!problems.length) console.log('  ok   both services are serving this checkout');

  // Services whose running commit could be read and compared. Recording the
  // number of CHANGED files here made a clean run write items = 0, which
  // reads as "verified nothing" - the one thing this check must never be
  // mistaken for.
  const verified = 1 + (mcpCommit ? 1 : 0);

  // A rehearsal must leave no trace: check-oracles reads the last recorded
  // run of every check, and a row written under a moved comparison base
  // would be a coverage number about a comparison nobody made.
  if (rehearsalBase) {
    if (problems.length) process.exitCode = 1;
    return;
  }

  logRun('check-deployed', {
    status: problems.length ? 'partial' : 'success',
    items: verified,
    error: problems.length ? problems.join(' ; ').slice(0, 1000) : undefined,
  }, getDb());

  if (problems.length) process.exitCode = 1;
}

main();
