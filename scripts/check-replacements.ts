import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { allDeprecations } from '../lib/deprecations';
import { isDeadEnd, ownerOfUrl, subjectOwners } from '../lib/deprecation-engine';

export function deadReplacements(db: ReturnType<typeof getDb>): { walked: number; problems: string[] } {
  const entries = allDeprecations(db);
  const owners = subjectOwners(entries);
  const problems: string[] = [];
  let walked = 0;
  for (const e of entries) {
    if (!e.replacement_url) continue;
    walked++;
    const target = ownerOfUrl(owners, e.replacement_url);
    if (target && target.id !== e.id && isDeadEnd(target)) {
      problems.push(`${e.id}: recommends ${e.replacement_url}, which ${target.id} marks ${target.status}`);
    }
  }
  return { walked, problems };
}

function main(): void {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) n FROM deprecations').get() as { n: number }).n;
  if (total === 0) {
    logRun('replacements', { status: 'partial', items: 0, error: 'UNVERIFIED: the deprecation index is empty' }, db);
    console.error('[check-replacements] UNVERIFIED: the deprecation index is empty');
    process.exitCode = 1;
    return;
  }
  const { walked, problems } = deadReplacements(db);
  for (const p of problems) console.error(`  ${p}`);
  logRun('replacements', {
    status: problems.length ? 'partial' : 'success',
    items: walked,
    error: problems.length ? problems.slice(0, 3).join(' | ').slice(0, 900) : undefined,
  }, db);
  console.log(problems.length
    ? `[check-replacements] ${problems.length} entr${problems.length === 1 ? 'y recommends' : 'ies recommend'} a dead replacement`
    : `[check-replacements] ${walked} replacements across ${total} entries: none points at a deprecated or removed entry`);
  if (problems.length) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(e);
    try { logRun('replacements', { status: 'error', items: 0, error: String(e).slice(0, 1000) }, getDb()); } catch { /* db down */ }
    process.exitCode = 1;
  }
}
