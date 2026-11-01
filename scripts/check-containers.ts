/**
 * A row that promises contents must hold them.
 *
 * WHY. A relationship between two tables reads as one fact and is two
 * claims: does every parent hold at least one child (a forum topic exists
 * because somebody posted to it, so a topic with no posts is a title with no
 * body), and does every child point at a parent that actually exists (a
 * dangling reference means a delete ran without its children, or a write
 * invented a key). A check for one direction and not the other catches half
 * the defect class and calls it done - that mistake has happened (a
 * container-emptiness fix landed hours before the dangling-reference half of
 * the same two tables was found separately).
 *
 * DECLARED, NOT INFERRED. Which tables are containers is a judgement: the
 * schema cannot say whether a parent with no children is a bug or a normal
 * state. Each relation below carries the reason an empty parent is wrong,
 * and where emptiness IS legitimate the scope says so rather than the check
 * quietly skipping it.
 *
 * NOT COVERED: the ADVERTISED half (a tool printing a stored counter above
 * rows it renders, rather than deriving the count from what it actually
 * shows). yourpedia's get_discussion already prints its reply count
 * DERIVED from held rows (see mcp-server.ts's own comment on heldReplies),
 * and the one remaining raw-counter print (Posts: ${topic.posts_count}) is
 * genuinely different in shape: it is informational metadata alongside a
 * fixed-cap post list, not a header claiming N items follow. Confirming or
 * fixing that needs product judgement this check isn't making blind.
 *
 *   npx tsx scripts/check-containers.ts
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';

interface Container {
  parent: string;
  child: string;
  /** Column on the parent, then the column on the child that points back. */
  parentKey: string;
  childKey: string;
  /** Restricts the parents this rule applies to, when emptiness is legitimate. */
  scope?: string;
  why: string;
  /**
   * Whether a child is allowed to hold no pointer at all, and why.
   *
   * Distinct from pointing at a parent that does not exist, which is never
   * allowed anywhere: that is a dangling reference. An absent pointer is a
   * different statement.
   */
  childMayBeUnattached?: string;
}

const CONTAINERS: Container[] = [
  {
    parent: 'forum_topics', child: 'forum_posts',
    parentKey: 'id', childKey: 'topic_id',
    why: 'a Discourse topic is created by its first post; a topic with none is a title with no body',
  },
  // Reverse-only relations. Nothing requires a CIP to carry an attachment or
  // a status change, so only the dangling direction is a claim here, and it
  // is the one that catches a delete that left its children behind.
  {
    parent: 'cips', child: 'cip_attachments',
    parentKey: 'id', childKey: 'cip_id',
    scope: '1 = 0',
    why: 'an attachment naming a CIP we do not hold is a file with no proposal behind it',
  },
  {
    parent: 'cips', child: 'cip_status_history',
    parentKey: 'id', childKey: 'cip_id',
    scope: '1 = 0',
    why: 'a status transition naming a CIP we do not hold describes something we cannot show',
  },
];

function main(): void {
  const db = getDb();
  const problems: string[] = [];
  let checked = 0;

  for (const c of CONTAINERS) {
    const where = c.scope ? `WHERE ${c.scope}` : '';
    let row: { total: number; empty: number };
    try {
      row = db.prepare(`
        SELECT COUNT(*) total, SUM(CASE WHEN n = 0 THEN 1 ELSE 0 END) empty FROM (
          SELECT p."${c.parentKey}" k, COUNT(ch."${c.childKey}") n
          FROM "${c.parent}" p
          LEFT JOIN "${c.child}" ch ON ch."${c.childKey}" = p."${c.parentKey}"
          ${where}
          GROUP BY p."${c.parentKey}"
        )
      `).get() as { total: number; empty: number };
    } catch (err) {
      problems.push(`${c.parent}: cannot be checked (${(err as Error).message.slice(0, 70)})`);
      continue;
    }

    checked++;
    const empty = row.empty ?? 0;
    if (c.scope === '1 = 0') {
      // Reverse-only: nothing requires this parent to have children.
    } else if (empty > 0) {
      const sample = db.prepare(`
        SELECT p."${c.parentKey}" k FROM "${c.parent}" p
        LEFT JOIN "${c.child}" ch ON ch."${c.childKey}" = p."${c.parentKey}"
        ${where}
        GROUP BY p."${c.parentKey}" HAVING COUNT(ch."${c.childKey}") = 0 LIMIT 5
      `).all() as { k: string }[];
      problems.push(
        `${c.parent}: ${empty} of ${row.total} hold no ${c.child} (${sample.map(s => s.k).join(', ')})`,
      );
    } else {
      console.log(`  ok      ${c.parent} → ${c.child}  ${row.total} parent(s), all hold at least one`);
    }

    // The other direction. A pointer naming a row that is not there is never
    // acceptable and needs no per-relation judgement.
    let dangling: { n: number };
    try {
      dangling = db.prepare(`
        SELECT COUNT(*) n FROM "${c.child}" ch
        WHERE ch."${c.childKey}" IS NOT NULL AND ch."${c.childKey}" <> ''
          AND NOT EXISTS (SELECT 1 FROM "${c.parent}" p WHERE p."${c.parentKey}" = ch."${c.childKey}")
      `).get() as { n: number };
    } catch (err) {
      problems.push(`${c.child}: cannot be checked for dangling refs (${(err as Error).message.slice(0, 60)})`);
      continue;
    }

    const unattached = (db.prepare(`
      SELECT COUNT(*) n FROM "${c.child}" ch
      WHERE ch."${c.childKey}" IS NULL OR ch."${c.childKey}" = ''
    `).get() as { n: number }).n;

    if (dangling.n > 0) {
      const sample = db.prepare(`
        SELECT ch."${c.childKey}" k FROM "${c.child}" ch
        WHERE ch."${c.childKey}" IS NOT NULL AND ch."${c.childKey}" <> ''
          AND NOT EXISTS (SELECT 1 FROM "${c.parent}" p WHERE p."${c.parentKey}" = ch."${c.childKey}")
        GROUP BY ch."${c.childKey}" LIMIT 5
      `).all() as { k: string }[];
      problems.push(
        `${c.child}: ${dangling.n} point at a ${c.parent} that does not exist (${sample.map(s => s.k).join(', ')})`,
      );
    } else {
      console.log(`  ok      ${c.child} → ${c.parent}  none point at a row that is not there`);
    }

    if (unattached > 0) {
      if (c.childMayBeUnattached) {
        console.log(`  note    ${c.child}: ${unattached} hold no ${c.parent} at all — ${c.childMayBeUnattached}`);
      } else {
        problems.push(`${c.child}: ${unattached} hold no ${c.parent} at all, and this relation does not declare that as possible`);
      }
    }
  }

  console.log(`[check-containers] ${checked} relation(s) checked both ways, ${problems.length} problem(s)`);

  for (const p of problems) console.error(`  BROKEN  ${p}`);
  if (problems.length) {
    console.error('  a parent with no children is content never fetched; a child with no parent is content nothing can reach');
  }

  logRun('check-containers', {
    status: problems.length ? 'partial' : 'success',
    items: checked,
    error: problems.length ? problems.join(' ; ').slice(0, 1000) : undefined,
  }, db);

  if (problems.length) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error('check-containers failed:', err);
  logRun('check-containers', { status: 'error', error: String(err).slice(0, 500) });
  process.exit(1);
}
