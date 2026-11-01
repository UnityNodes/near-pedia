/**
 * Reconstruct the real CIP status timeline from the git history of
 * your-org/CIPs.
 *
 * sync-cips only records a transition when it *notices* one between two of its
 * own runs, so cip_status_history began accumulating on the day nearpedia
 * started running - two rows for 51 CIPs, and both timestamped when we first
 * saw the value rather than when it actually changed. Every Draft -> Review ->
 * Last Call -> Final that happened before that was simply absent, which made
 * get_cip_history and /api/v1/cips/:id/history answer "no history" for CIPs
 * with years of it.
 *
 * The upstream repo carries the truth: each status change is a commit that
 * edits the `status` row of the CIP's markdown table. We replay those commits
 * and record the transitions with their real dates.
 *
 * Deliberate choices:
 *   - `git log --full-history`, because git's default history simplification
 *     hides commits that reached main through a merge (cip-049 shows 2 commits
 *     instead of 6 without it).
 *   - parseTableFrontmatter is shared with sync-cips, so a status here can
 *     never disagree with the status stored on the CIP row.
 *   - Earliest date wins on conflict: a git date always predates the day we
 *     first observed the same transition live, so re-running corrects the
 *     coarse live-observed rows instead of duplicating them.
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '../lib/db';
import { guardSync } from '../lib/sync-log';
import { parseTableFrontmatter } from '../lib/parsers/cip-frontmatter';

const REPO = 'https://github.com/your-org/CIPs.git';
const CIP_FILE = /^cips\/cip-(\d+)\.md$/;

interface Transition {
  cipId: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function collectTransitions(repoDir: string): Transition[] {
  const files = git(repoDir, ['ls-files'])
    .split('\n')
    .filter((f) => CIP_FILE.test(f))
    .sort();
  if (files.length === 0) {
    throw new Error('[backfill-cip-history] no CIP files in the clone - refusing to write');
  }

  const out: Transition[] = [];
  for (const file of files) {
    const cipInt = parseInt(file.match(CIP_FILE)![1], 10);
    const cipId = String(cipInt).padStart(4, '0');

    const log = git(repoDir, [
      'log', '--full-history', '--reverse', '--format=%H %aI', '--', file,
    ]).split('\n').filter(Boolean);

    let prev: string | null = null;
    for (const line of log) {
      const sep = line.indexOf(' ');
      const sha = line.slice(0, sep);
      const date = line.slice(sep + 1).trim();

      let content: string;
      try {
        content = git(repoDir, ['show', `${sha}:${file}`]);
      } catch {
        continue; // file absent at this commit (added later on this path)
      }
      const status = parseTableFrontmatter(content).meta['status']?.trim();
      if (!status) continue;

      if (status !== prev) {
        // `%aI` is the commit author's own local offset ("+02:00", "+04:00",
        // whichever the committer's machine had), verbatim and un-normalized.
        // Two commits authored in different zones then hold the same instant
        // in text shapes that do not compare equal, so ORDER BY changed_at
        // (mcp-server.ts, the feed routes, the weekly digest, ...) sorted on
        // the offset rather than the time - check-formats' G3 caught it live:
        // "2025-06-17T16:50:48+02:00" (16:50 in a UTC+2 zone) sorted AFTER
        // "2025-06-17T18:47:20+04:00" (14:47 UTC) even though it happened
        // over an hour earlier. Normalizing to UTC here keeps the instant and
        // makes every stored value share one shape, so text order is time
        // order again.
        out.push({ cipId, fromStatus: prev, toStatus: status, changedAt: new Date(date).toISOString() });
        prev = status;
      }
    }
  }
  return out;
}

async function main(): Promise<number> {
  const db = getDb();

  // One row per (cip, status reached). Verified against the upstream history:
  // no CIP reaches the same status twice, so this cannot collapse distinct
  // events. Keeping the earliest date means a genuine future re-entry would
  // preserve the first occurrence rather than overwrite it.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cip_status_unique
           ON cip_status_history(cip_id, to_status)`);

  const dir = mkdtempSync(join(tmpdir(), 'cips-history-'));
  let transitions: Transition[];
  try {
    git(dir, ['clone', '--quiet', REPO, 'repo']);
    transitions = collectTransitions(join(dir, 'repo'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const known = new Set(
    (db.prepare('SELECT id FROM cips').all() as Array<{ id: string }>).map((r) => r.id),
  );

  const upsert = db.prepare(`
    INSERT INTO cip_status_history (cip_id, from_status, to_status, changed_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cip_id, to_status) DO UPDATE SET
      from_status = excluded.from_status,
      changed_at  = MIN(cip_status_history.changed_at, excluded.changed_at)
  `);

  let written = 0;
  let skipped = 0;
  db.transaction(() => {
    for (const t of transitions) {
      if (!known.has(t.cipId)) { skipped++; continue; }
      upsert.run(t.cipId, t.fromStatus, t.toStatus, t.changedAt);
      written++;
    }
  })();

  const total = (db.prepare('SELECT COUNT(*) c FROM cip_status_history').get() as { c: number }).c;
  const covered = (db.prepare(
    'SELECT COUNT(DISTINCT cip_id) c FROM cip_status_history',
  ).get() as { c: number }).c;
  console.log(
    `[backfill-cip-history] ${transitions.length} transitions found, ${written} written` +
    `${skipped ? `, ${skipped} skipped (CIP not indexed)` : ''}; ` +
    `table now ${total} rows across ${covered} CIPs`,
  );
  return written;
}

guardSync('cip-history', main).catch((e) => { console.error(e); process.exit(1); });
