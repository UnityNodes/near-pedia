/**
 * Does every scheduled check publish how much of its surface it reached?
 *
 * WHY. This app has 50 standing checks, and all of them
 * report the same way: a line in `sync_log` with a status and a count.
 * Nothing asked what the count meant.
 *
 * Among the checks originally audited, `items` held five different
 * things - elements examined, defects found, elements that passed,
 * milliseconds, and nothing at all - and a run reporting success while
 * having examined zero is indistinguishable from a run that did nothing.
 * That is the defect class this gates: THE ORACLE DOES NOT PUBLISH ITS OWN
 * DENOMINATOR.
 *
 * FOUR GATES:
 *
 *   O1  the registry and deploy/sync-tick.sh name the same checks
 *   O2  every scheduled check records a count at all
 *   O3  a run that reports success did not examine nothing
 *   O4  where a second source exists, the count is the size of the surface
 *   O5  and that comparison says how it survives a surface that grew between
 *       the walk and this line
 *
 * O3 is the cheap one and it does the most work: it needs no registry entry
 * and no second source, and it catches the whole family of
 * `items: problems.length` without knowing anything about the check.
 *
 * WHAT IT CANNOT SEE. O4 applies to 8 of 51 checks here (the checks with a
 * schema, git, or index second source rather than a hand-held list). The other
 * 43 walk a list they hold themselves, and a count taken from that same list
 * would be a check whose two sides come from one place - it could only pass.
 * Those are declared in lib/oracles.ts with reasons, and the count of each
 * kind is printed on every run, so this check's own coverage is a number and
 * not an impression.
 *
 * It also reads the LAST RECORDED RUN rather than running anything. A check
 * that has not run since its code changed is answered for by
 * check-scheduled, which owns staleness; this one owns meaning.
 *
 *   npx tsx scripts/check-oracles.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { ORACLES } from '../lib/oracles';
import { isEntrypoint } from '../lib/is-entrypoint';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TICK = path.join(ROOT, 'deploy', 'sync-tick.sh');

interface Problem { gate: string; where: string; what: string; fix?: string }
const problems: Problem[] = [];
function fail(gate: string, where: string, what: string, fix?: string): void {
  problems.push({ gate, where, what, fix });
}

/** Checks deploy/sync-tick.sh actually schedules, in the order it runs them. */
function scheduled(): string[] {
  const src = fs.readFileSync(TICK, 'utf8');
  const out = new Set<string>();
  // Not anchored to line start: this app's bucket bodies are one compact `run a; run b; run
  // c; ...` line each, so every scheduled name after the first sits mid-line
  // after a semicolon. A `^`-anchored version found the first check of each
  // bucket and nothing else - "0 scheduled" on a file that runs 51 of them.
  for (const m of src.matchAll(/\brun\s+(check-[a-z0-9-]+)\b/g)) out.add(m[1]);
  return [...out];
}

/**
 * The name a check writes to sync_log under.
 *
 * Derived from the script rather than stored in the registry: a stored name
 * goes stale the first time somebody renames the source string, and a
 * registry that is wrong about where to look reports "never ran" for a check
 * that runs fine.
 */
function sourceCandidates(script: string): string[] {
  const p = path.join(ROOT, 'scripts', `${script}.ts`);
  let src: string;
  try { src = fs.readFileSync(p, 'utf8'); } catch { return []; }
  const names = new Set<string>();
  for (const m of src.matchAll(/\b(?:logRun|guardSync)\(\s*'([a-z0-9-]+)'/g)) names.add(m[1]);
  return [...names];
}

/**
 * Which of those candidates is this check's own row.
 *
 * A resolver that guesses is worse than one that refuses: taking whichever
 * candidate had the most recent run would read a five-minute sync's row as a
 * daily check's coverage the moment their names happened to collide.
 */
function resolveSource(script: string, declared: string | undefined, candidates: string[]): string | null {
  if (declared) {
    if (!candidates.includes(declared)) {
      fail('O2', script, `is declared to log as "${declared}" but the script logs as ${candidates.map((c) => `"${c}"`).join(', ') || 'nothing'}`,
        'update the source in lib/oracles.ts to the name the script actually uses');
      return null;
    }
    return declared;
  }
  if (candidates.includes(script)) return script;
  if (candidates.length === 1) return candidates[0];
  fail('O2', script, `logs under more than one name (${candidates.join(', ')}) and none of them is the script name`,
    'set source in lib/oracles.ts to whichever one records this check\'s own run');
  return null;
}

interface LastRun { source: string; status: string; items: number | null; ranAt: string }

function lastRun(db: ReturnType<typeof getDb>, source: string): LastRun | null {
  return (db.prepare(
    `SELECT source, status, items_synced AS items, ran_at AS ranAt
       FROM sync_log WHERE source = ? ORDER BY ran_at DESC, id DESC LIMIT 1`,
  ).get(source) as LastRun | undefined) ?? null;
}

function main(): void {
  const db = getDb();
  const sched = scheduled();
  const registry = new Map(ORACLES.map((o) => [o.script, o]));

  // ── O1: the registry and the schedule name the same checks ────────────────
  for (const s of sched) {
    if (!registry.has(s)) {
      fail('O1', s, 'is scheduled in sync-tick but names no surface',
        'add an entry to lib/oracles.ts saying what one element of its walk is');
    }
  }
  for (const o of ORACLES) {
    if (!fs.existsSync(path.join(ROOT, 'scripts', `${o.script}.ts`))) {
      fail('O1', o.script, 'is in the registry but the script does not exist',
        'remove the entry, or restore the script');
    } else if (!sched.includes(o.script)) {
      fail('O1', o.script, 'is in the registry but sync-tick does not run it',
        'schedule it, or drop the entry so the registry keeps meaning the scheduled set');
    }
  }

  // ── O2/O3/O4: what each check recorded about its own walk ─────────────────
  let withSecondSource = 0;
  let declared = 0;
  let measured = 0;
  const lines: string[] = [];

  for (const script of sched) {
    const o = registry.get(script);
    if (!o) continue;
    if (o.total) withSecondSource++; else declared++;

    const names = sourceCandidates(script);
    if (names.length === 0) {
      fail('O2', script, 'calls neither logRun nor guardSync, so no run of it is recorded anywhere',
        'wrap main() in guardSync, or call logRun with a count');
      continue;
    }

    const source = resolveSource(script, o.source, names);
    if (!source) continue;

    const run = lastRun(db, source);
    if (!run) {
      fail('O2', script, `has never written to sync_log under "${source}"`,
        'check-scheduled owns whether it runs; this is about whether a run can be counted');
      continue;
    }

    if (run.items === null) {
      fail('O2', `${script} (${run.source})`, 'records a run but no count, so how much it examined is unknown',
        'pass items: <elements examined> to logRun, or return the count from the function guardSync wraps');
      continue;
    }

    // O3 is deliberately restricted to a run the check itself called clean. A
    // partial or error run may legitimately have examined nothing.
    if (run.status === 'success' && run.items === 0) {
      fail('O3', `${script} (${run.source})`,
        `reported success having examined 0 ${o.surface}(s), which is what a run that did nothing records`,
        'items must count what was examined, not what was found: a clean run of a real walk cannot be zero');
      continue;
    }

    if (o.total) {
      const total = o.total(db);
      const tol = o.tolerance ?? 0;
      measured++;
      // ── O5 ────────────────────────────────────────────────────────────────
      // A comparison across two clocks can only look short on a surface that
      // grows: the numerator was recorded when the check ran, the
      // denominator is computed on the line above.
      if (!o.grownSince && !o.whyGrowthCannotExplain) {
        fail('O5', script,
          'compares against a second source but says nothing about a surface that grew between the walk and this comparison',
          'add grownSince where a first-seen clock exists, or whyGrowthCannotExplain and keep it scheduled before check-oracles');
      } else if (!o.grownSince) {
        const here = sched.indexOf(script);
        const mine = sched.indexOf('check-oracles');
        if (here === -1 || mine === -1 || here > mine) {
          fail('O5', script,
            'relies on running before check-oracles to keep the two clocks close, but the schedule runs it after',
            'move it earlier in deploy/sync-tick.sh, or give it a grownSince that does not depend on the order');
        }
      }
      const grown = o.grownSince && run.ranAt ? o.grownSince(db, run.ranAt) : 0;
      const short = total - run.items - grown;
      if (run.items > total) {
        fail('O4', `${script} (${run.source})`,
          `counted ${run.items} ${o.surface}(s) but only ${total} exist, so the count is of something else`,
          'items must be the size of the walk this check performs');
      } else if (short > tol) {
        fail('O4', `${script} (${run.source})`,
          `examined ${run.items} of ${total} ${o.surface}(s)`
          + (grown ? `, ${grown} of which arrived after the walk; ${short} were not reached` : `; ${short} were not reached`)
          + ' and nothing says which',
          o.why
            ? `a shortfall is declared as: ${o.why} — raise tolerance only if that still explains it`
            : 'name the shortfall in lib/oracles.ts with a reason, or make the walk complete');
      }
      lines.push(`  ${short > tol ? 'SHORT' : 'ok   '} ${script.padEnd(26)} ${String(run.items).padStart(6)} / ${String(total).padEnd(6)}`
        + (grown ? ` (+${grown} since the walk)` : '') + ` ${o.surface}`);
    } else {
      lines.push(`  ok    ${script.padEnd(26)} ${String(run.items).padStart(6)} / ${'—'.padEnd(6)} ${o.surface}`);
    }
  }

  // ── O5: a status nobody declared is a row every gate skips ────────────────
  //
  // Every gate above switches on `status`. A row holding something else is
  // INVISIBLE to them - O3 only looks at 'success', so a check writing 'ok'
  // or 'done' would pass every gate here forever.
  const declaredStatuses = (() => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'sync-log.ts'), 'utf8');
    const m = /export type RunStatus\s*=\s*([^;]+);/.exec(src);
    return new Set((m?.[1] ?? '').match(/'([a-z]+)'/g)?.map((s) => s.replace(/'/g, '')) ?? []);
  })();
  if (declaredStatuses.size === 0) {
    fail('O5', 'lib/sync-log.ts', 'no RunStatus union could be read, so the statuses below are compared against nothing',
      'this gate reads `export type RunStatus = ...`; restore it or update the pattern');
  } else {
    for (const r of db.prepare(`SELECT status, COUNT(*) n FROM sync_log GROUP BY status`).all() as { status: string; n: number }[]) {
      if (declaredStatuses.has(r.status)) continue;
      fail('O5', `sync_log.status = "${r.status}"`,
        `${r.n} row(s) hold a status lib/sync-log.ts does not declare, so every gate that switches on status skips them`,
        `use one of ${[...declaredStatuses].join(', ')}, or add it to RunStatus if it is a real outcome`);
    }
  }

  console.log(`[check-oracles] ${sched.length} scheduled check(s); ${withSecondSource} counted against a second source, ${declared} declared without one`);
  console.log(`                statuses declared: ${[...declaredStatuses].join(', ')}`);
  for (const l of lines) console.log(l);

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) {
      console.error(`  ${p.gate} ${p.where}: ${p.what}`);
      if (p.fix) console.error(`      ${p.fix}`);
    }
  } else {
    console.log(`\nevery scheduled check says how much of its surface it reached (${measured} against an independent count)`);
  }

  logRun('check-oracles', {
    status: problems.length ? 'partial' : 'success',
    items: sched.length,
    error: problems.length
      ? problems.map((p) => `${p.gate} ${p.where}: ${p.what}`).join(' ; ').slice(0, 1000)
      : undefined,
  }, db);

  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) main();
