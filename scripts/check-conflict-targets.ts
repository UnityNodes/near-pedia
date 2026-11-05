/**
 * Two writers into one table must handle the same collision.
 *
 * WHY. This has happened: two syncs into the same table disagreed on
 * ON CONFLICT target (one keyed on id, the other on the table's actual UNIQUE
 * column) and the run died with a UNIQUE constraint failure. The fix made both
 * writers agree on the id FORMAT and left them disagreeing on the TARGET —
 * half a fix looks exactly like a fix until the next caller.
 *
 * The rule is not "everyone must use the same column" — a table can genuinely
 * need two. It is that a disagreement has to be written down with its reason,
 * so the next person reads a decision instead of finding a crash. Same shape
 * as ECHOES in check-upstream-echo, for the same reason: the failure mode is
 * silence.
 *
 * Reads source with a regex, so it can miss a statement built by string
 * concatenation. A miss leaves things where they were; a hit is always a real
 * pair of writers on a real table.
 *
 *   npx tsx scripts/check-conflict-targets.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';

const ROOTS = ['scripts', 'lib', 'app'];

/**
 * Tables written with more than one conflict target on purpose.
 *
 * The allowed set is exact, not a blanket pardon for the table. The first
 * version excused any disagreement once a table was named here, and the
 * negative control walked straight through it: introducing a third, unrelated
 * target on blog_posts passed silently. A declaration that grows to cover
 * whatever appears next is the same silence this file exists to break.
 */
const DECLARED: Record<string, { targets: string[]; why: string }> = {};

interface Site { file: string; target: string }

function sources(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
    }
  };
  for (const r of ROOTS) if (fs.existsSync(path.join(process.cwd(), r))) walk(path.join(process.cwd(), r));
  return out;
}

function main(): void {
  const byTable = new Map<string, Site[]>();

  for (const file of sources()) {
    const src = fs.readFileSync(file, 'utf-8');
    for (const m of src.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["'`]?(\w+)["'`]?([\s\S]{0,700}?)(?:;|`\)|`,)/gi)) {
      const table = m[1];
      if (/^sqlite_/.test(table)) continue;
      const oc = /ON CONFLICT\s*\(([^)]*)\)/i.exec(m[2]);
      if (!oc) continue;
      const target = oc[1].replace(/\s+/g, '');
      const rel = path.relative(process.cwd(), file);
      const list = byTable.get(table) ?? [];
      if (!list.some(s => s.file === rel && s.target === target)) list.push({ file: rel, target });
      byTable.set(table, list);
    }
  }

  const problems: string[] = [];
  const declaredOk: string[] = [];
  let tables = 0;

  for (const [table, sites] of [...byTable].sort()) {
    const targets = new Set(sites.map(s => s.target));
    if (targets.size < 2) continue;
    tables++;
    const detail = [...targets]
      .map(t => `${t} (${sites.filter(s => s.target === t).map(s => path.basename(s.file)).join(', ')})`)
      .join(' vs ');
    const allowed = DECLARED[table]?.targets;
    if (!allowed) {
      problems.push(`${table}: ${detail}`);
      continue;
    }
    const unexpected = [...targets].filter(t => !allowed.includes(t));
    if (unexpected.length) {
      problems.push(
        `${table}: ${detail} — ${unexpected.join(', ')} not among the declared targets (${allowed.join(', ')})`,
      );
    } else {
      declaredOk.push(`${table}: ${detail}`);
    }
  }

  // A declaration for a table that no longer disagrees is stale bookkeeping,
  // and stale bookkeeping is how the original disagreement stayed invisible.
  const stillMixed = new Set([...byTable].filter(([, s]) => new Set(s.map(x => x.target)).size > 1).map(([t]) => t));
  const stale = Object.keys(DECLARED).filter(t => !stillMixed.has(t));

  console.log(
    `[check-conflict-targets] ${byTable.size} table(s) written with an ON CONFLICT, ` +
    `${tables} with more than one target, ${declaredOk.length} declared, ${problems.length} undeclared`,
  );
  for (const d of declaredOk) console.log(`  declared    ${d}`);
  for (const p of problems) {
    console.error(`  MIXED       ${p}`);
    console.error('              make them agree, or declare the table here with the reason they cannot');
  }
  for (const s of stale) console.error(`  STALE       DECLARED names ${s}, which no longer has two targets`);

  const failures = problems.length + stale.length;
  logRun('check-conflict-targets', {
    status: failures ? 'partial' : 'success',
    items: byTable.size,
    error: failures ? [...problems, ...stale.map(s => `stale ${s}`)].join(' ; ').slice(0, 1000) : undefined,
  }, getDb());

  if (failures) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error('check-conflict-targets failed:', err);
  logRun('check-conflict-targets', { status: 'error', error: String(err).slice(0, 500) });
  process.exit(1);
}
