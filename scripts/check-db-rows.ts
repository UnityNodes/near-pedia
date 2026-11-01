import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { renderDbRows } from './generate-db-rows';

/**
 * lib/db-rows.ts is a copy of the schema, and a copy can go stale.
 *
 * The interfaces exist so that reading a column the query did not select is a
 * compile error rather than an `undefined` that reaches an agent. That only
 * holds while the file matches the database. Add a column, forget to
 * regenerate, and the type says the column does not exist while the row has it,
 * or worse says a dropped column is still there and callers keep formatting it.
 *
 * So this re-renders from PRAGMA table_info and compares byte for byte. It does
 * not repair: a silent rewrite here would hide a schema change nobody meant to
 * make. Run `npx tsx scripts/generate-db-rows.ts` to accept one.
 */
function main() {
  const db = getDb();
  const file = path.join(process.cwd(), 'lib', 'db-rows.ts');

  let committed = '';
  try {
    committed = readFileSync(file, 'utf-8');
  } catch {
    console.error('[check-db-rows] lib/db-rows.ts is missing; run scripts/generate-db-rows.ts');
    logRun('check-db-rows', { status: 'partial', items: 0, error: 'lib/db-rows.ts missing' }, db);
    process.exitCode = 1;
    return;
  }

  const fresh = renderDbRows();
  const tables = (fresh.match(/^export interface \w+Row \{/gm) ?? []).length;

  if (committed === fresh) {
    console.log(`[check-db-rows] ${tables} tables, lib/db-rows.ts matches the schema`);
    logRun('check-db-rows', { status: 'success', items: tables }, db);
    return;
  }

  const a = committed.split('\n');
  const b = fresh.split('\n');
  const diffs: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length) && diffs.length < 20; i++) {
    if (a[i] !== b[i]) diffs.push(`  line ${i + 1}\n    committed: ${a[i] ?? '(absent)'}\n    schema:    ${b[i] ?? '(absent)'}`);
  }

  console.error(
    `[check-db-rows] lib/db-rows.ts is STALE against the schema ` +
    `(${a.length} lines committed, ${b.length} from the database, ${tables} tables)`,
  );
  for (const d of diffs) console.error(d);
  console.error('  run: npx tsx scripts/generate-db-rows.ts');

  logRun('check-db-rows', {
    status: 'partial',
    items: tables,
    error: `db-rows.ts stale: ${diffs.length} differing line(s), first at ${diffs[0]?.split('\n')[0]?.trim()}`.slice(0, 1000),
  }, db);
  process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error('[check-db-rows] failed:', err);
  try { logRun('check-db-rows', { status: 'error', items: 0, error: String(err).slice(0, 1000) }, getDb()); } catch { /* db down */ }
  process.exitCode = 1;
}
