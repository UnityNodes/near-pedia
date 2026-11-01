/**
 * Every sync either deletes, or says out loud why it never needs to.
 *
 * The POLICY table below is built from reading this app's own sync scripts.
 *
 * WHY. A sync that only ever inserts looks identical, in sync_log, to a sync
 * with nothing to remove. lib/prune.ts exists for exactly the syncs that DO
 * need to remove rows; most of this app's syncs never call it, and
 * whether that is correct was nowhere written down.
 *
 * That is the actual defect. Not the missing deletes: the missing decision. A
 * table nobody chose a policy for gets whichever policy the first author
 * happened to write, and the next person reads the absence as intent.
 *
 * So this is a forcing function rather than a rule. A sync that deletes needs
 * no entry. A sync that does not must appear below with the reason, and the
 * reasons are not interchangeable:
 *
 *   covered      a completeness check compares this source set against upstream
 *                and a surplus would show, so a stale row cannot hide
 *   permanent    upstream does not retract; the record stands even when a
 *                status changes (a CIP is withdrawn, a GitHub item closes)
 *   not-a-writer meta-runner or file copier, owns no table
 *   owned        another sync owns the delete for this table
 *   accumulating the table is a log of versions seen, never a mirror of a set
 *
 *   npx tsx scripts/check-delete-policy.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';

type Reason = 'covered' | 'permanent' | 'not-a-writer' | 'owned' | 'accumulating';

const POLICY: Record<string, { reason: Reason; why: string; sweeps?: boolean }> = {

  // check-completeness.ts names these two as its covered scope explicitly
  // (cips: git tree, ecosystem_projects: data file) - a surplus in either
  // would show there, so a delete path here would be a second, redundant
  // lifecycle mechanism.
  'sync-cips': { reason: 'covered', why: 'check-completeness compares the CIP set against the your-org/CIPs git tree exactly; a stale row would show as surplus' },
  'sync-ecosystem': { reason: 'covered', why: 'check-completeness compares ecosystem_projects against the same ecosystemExplorer.js data file sync-ecosystem.ts evaluates' },

  // check-completeness.ts explicitly excludes these two from its scope (see
  // that file's own SCOPE comment) for reasons of fetch complexity or the
  // absence of a meaningful upstream total - not because the underlying
  // record is disposable. Each is permanent in its own right regardless of
  // whether completeness-checking ever reaches it.
  'sync-foundation': { reason: 'permanent', why: 'foundation_kb is curated from the yourchain.example About page; content gets edited in place (ON CONFLICT DO UPDATE), never removed - there is no upstream "this entry no longer exists" signal to prune against' },
  'sync-papers': { reason: 'permanent', why: 'arXiv and IACR ePrint papers (whitepapers table) are permanent published records; check-completeness excludes this source only because no upstream total means the same thing as our row count' },

  // The direct analogue of sync-cips' own reasoning: a github_items row is a
  // permanent record, and closing/merging is a status change (open -> closed
  // via UPDATE), not a removal. Confirmed by reading the sync: it reconciles
  // open items no longer returned by the API to state='closed' rather than
  // deleting them - the item never actually disappears from GitHub's history
  // either, only its state changes.
  'sync-github-items': { reason: 'permanent', why: 'a github_items row is a permanent record; an item merged/closed upstream is reconciled to state=closed via UPDATE (see the "Reconcile" comment in sync-github-items.ts), never deleted' },

  // Updates transcript columns on rows sync-youtube
  // creates. Confirmed: this script only ever UPDATEs youtube_videos, never
  // INSERTs or DELETEs.
  'sync-youtube-transcripts': { reason: 'owned', why: 'updates transcript_text/transcript_synced_at on rows sync-youtube creates; owns no lifecycle decision of its own' },
};

/** A sync that removes rows, detected from source rather than remembered. */
function deletes(file: string): boolean {
  const src = fs.readFileSync(file, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  return /\bDELETE\s+FROM\b/i.test(src) || /\bpruneMissing\b|\bprune\(/.test(src);
}

function main(): void {
  const dir = path.join(process.cwd(), 'scripts');
  const syncs = fs.readdirSync(dir).filter(f => f.startsWith('sync-') && f.endsWith('.ts'));

  const deleting: string[] = [];
  const declared: string[] = [];
  const undeclared: string[] = [];

  for (const f of syncs) {
    const name = f.replace(/\.ts$/, '');
    if (deletes(path.join(dir, f))) { deleting.push(name); continue; }
    if (name in POLICY) { declared.push(name); continue; }
    undeclared.push(name);
  }

  // A policy for a sync that now deletes, or no longer exists, is stale
  // bookkeeping, and stale bookkeeping is how the absence read as intent.
  const names = new Set(syncs.map(f => f.replace(/\.ts$/, '')));
  const stale = Object.keys(POLICY).filter(p =>
    !names.has(p)
    || (deleting.includes(p) && !POLICY[p].sweeps)
    || (!!POLICY[p].sweeps && !deleting.includes(p)));

  console.log(
    `[check-delete-policy] ${syncs.length} sync(s): ${deleting.length} delete, ` +
    `${declared.length} declared, ${undeclared.length} undeclared`,
  );

  const byReason = new Map<Reason, number>();
  for (const d of declared) {
    const r = POLICY[d].reason;
    byReason.set(r, (byReason.get(r) ?? 0) + 1);
  }
  for (const [r, n] of [...byReason].sort()) console.log(`  ${r.padEnd(13)} ${n}`);

  for (const u of undeclared) {
    console.error(`  UNDECLARED  ${u} never deletes and has no policy — give it a prune, or a reason here`);
  }
  for (const s of stale) console.error(`  STALE       POLICY names ${s}, which now deletes or no longer exists`);

  const failures = undeclared.length + stale.length;
  logRun('check-delete-policy', {
    status: failures ? 'partial' : 'success',
    items: syncs.length,
    error: failures
      ? [...undeclared.map(u => `undeclared ${u}`), ...stale.map(s => `stale ${s}`)].join(' ; ').slice(0, 1000)
      : undefined,
  }, getDb());

  if (failures) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error('[check-delete-policy] failed:', err);
  try { logRun('check-delete-policy', { status: 'error', items: 0, error: String(err).slice(0, 1000) }, getDb()); } catch { /* db down */ }
  process.exitCode = 1;
}
