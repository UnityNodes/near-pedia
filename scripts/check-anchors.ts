/**
 * A reference to an identifier must not match a longer identifier, and every
 * way of naming a CIP must reach the same record.
 *
 * HALF 1: no unanchored CIP-mention pattern survives in the serving layer.
 * Finding "who mentions CIP-42" in free text is a substring search, and a
 * substring search on a number has no right edge: '%CIP-1%' matches CIP-10
 * through CIP-19 and beyond. lib/cip-mention-patterns.ts's cipCitesSql()
 * already fixes this (a broad LIKE prefilter plus a strict cip_cites()
 * regex anchor as the actual test, both applied with the SAME predicate so
 * a count and its sample cannot drift apart) - this guards against a future
 * caller reaching for the raw cipMentionLikeStrings()/'%...%' form instead.
 *
 * HALF 2: id-form resolution. cips.id holds two namespaces under one
 * prefix: a merged CIP stored under its own number, and a draft PR that HAS
 * declared a CIP number, stored under a PR-#### id (getCipById resolves
 * "0088" to that PR- row via a cip_number fallback when no bare "0088" row
 * exists). getCipStatusHistory and getCipAttachments write/read
 * cip_status_history.cip_id / cip_attachments.cip_id as the exact cips.id
 * string, so a CHILD reader that does its own bare strip+pad instead of
 * resolving through getCipById the same way the PARENT does will silently
 * return nothing for a draft that has real history or attachments the
 * moment it is far enough along to have any - found live while writing this check (no
 * currently-tracked CIP happens to be in that state, but the code path was
 * broken and would have served an empty timeline for a real one; fixed in
 * lib/cips.ts alongside this check).
 *
 * yourpedia's citation surface (getCipForumMentions/getCipBlogMentions/
 * getCipProposalMentions/getCipOtherMentions) returns a capped sample of rows,
 * not an exhaustive count, so there is no served total to hold a count
 * oracle to.
 *
 *   npx tsx scripts/check-anchors.ts
 */

import fs from 'node:fs';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { repoPath } from '../lib/repo-root';
import { stripJsComments } from '../lib/strip-comments';
import { getCipById, getCipStatusHistory, getCipAttachments } from '../lib/cips';

/**
 * Source shapes that build a raw LIKE pattern out of a CIP id instead of
 * going through cipCitesSql()'s anchored predicate.
 */
const BANNED_SOURCE = [
  { re: /cipMentionLikeStrings\s*\(/, what: 'the raw %...% LIKE-pattern helper, not cipCitesSql\'s anchored predicate' },
  { re: /%cip[- ]\$\{/i, what: "a 'cip-N' / 'cip N' LIKE built by interpolation" },
];

const GUARDED_FILES = ['mcp-server.ts', 'lib/cips.ts'];

async function main(): Promise<void> {
  const problems: Array<{ kind: string; what: string }> = [];
  const lines: string[] = [];

  // ── half 1: no unanchored id pattern survives in the serving layer ─────────
  const before = problems.length;
  for (const rel of GUARDED_FILES) {
    const src = stripJsComments(fs.readFileSync(repoPath(rel), 'utf8'));
    for (const b of BANNED_SOURCE) {
      if (b.re.test(src)) {
        problems.push({ kind: 'unanchored-source', what: `${rel} still builds ${b.what}; use cipCitesSql so the match has a right edge` });
      }
    }
  }
  if (problems.length === before) lines.push(`  ok    source        ${GUARDED_FILES.length} file(s) carry no unanchored CIP LIKE`);

  // ── half 2: every way of naming a CIP reaches the same record ──────────────
  const db = getDb();
  const aliasProblemsBefore = problems.length;
  let idForms = 0;
  const rows = db.prepare('SELECT id, cip_number FROM cips ORDER BY id').all() as Array<{ id: string; cip_number: number | null }>;
  for (const r of rows) {
    const canonicalHistory = getCipStatusHistory(r.id).length;
    const canonicalAttachments = getCipAttachments(r.id).length;
    const forms = new Set<string>([r.id, `CIP-${r.id}`]);
    if (r.cip_number !== null) {
      forms.add(String(r.cip_number));
      forms.add(String(r.cip_number).padStart(4, '0'));
    }
    for (const form of forms) {
      idForms++;
      const row = getCipById(form);
      if (!row) {
        problems.push({ kind: 'id-unreachable', what: `"${form}" names CIP ${r.id} and getCipById returns nothing for it` });
        continue;
      }
      if (row.id !== r.id) {
        problems.push({ kind: 'id-crossed', what: `"${form}" names CIP ${r.id} but resolves to ${row.id}` });
        continue;
      }
      const h = getCipStatusHistory(form).length;
      const a = getCipAttachments(form).length;
      if (h !== canonicalHistory) {
        problems.push({ kind: 'child-not-resolved', what: `getCipStatusHistory("${form}") returns ${h} where getCipStatusHistory("${r.id}") returns ${canonicalHistory}; the child reader is not resolving the alias its parent resolved` });
      }
      if (a !== canonicalAttachments) {
        problems.push({ kind: 'child-not-resolved', what: `getCipAttachments("${form}") returns ${a} where getCipAttachments("${r.id}") returns ${canonicalAttachments}` });
      }
    }
  }
  if (problems.length === aliasProblemsBefore) {
    lines.push(`  ok    id forms      ${idForms} way(s) of naming a CIP reach the same record, children included`);
  }

  for (const l of lines) console.log(l);
  for (const p of problems.slice(0, 12)) console.error(`  [${p.kind}] ${p.what}`);
  if (problems.length > 12) console.error(`  … and ${problems.length - 12} more`);

  logRun('anchors', {
    status: problems.length ? 'error' : 'success',
    items: GUARDED_FILES.length + idForms,
    error: problems.length
      ? `${problems.length} anchor problem(s): ` + problems.slice(0, 3).map(p => `${p.kind} ${p.what.slice(0, 80)}`).join(' | ')
      : undefined,
  });

  console.log(
    problems.length
      ? `[check-anchors] ${problems.length} problem(s) over ${idForms} id forms`
      : `[check-anchors] ${idForms} id forms reach the same record including children, and ${GUARDED_FILES.length} files carry no unanchored pattern`,
  );
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  main().catch(err => {
    console.error('check-anchors failed:', err);
    logRun('anchors', { status: 'error', error: String(err).slice(0, 500) });
    process.exit(1);
  });
}
