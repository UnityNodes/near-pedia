/**
 * Fail when a shared file has drifted from the reskin template.
 *
 * `your-org/pedia-template` (see RESKIN.md) is a full copy of this app, so a
 * fix made here reaches it only if somebody remembers to port it by hand.
 * This has happened: a template sat 338 commits behind and still shipped the
 * fail-open rate limit and both INSERT OR REPLACE wipes this repo's own
 * 2026-08-01/02 audits found independently, in the same lines.
 *
 * Porting once resets that clock rather than stopping it. This makes the
 * drift loud: every path in lib/template-manifest.ts is compared against the
 * template on GitHub, and a difference is reported, not silently accepted.
 *
 * Reads GitHub rather than a local clone on purpose. A clone is one more
 * thing that goes stale, and the question is what the template ACTUALLY
 * contains, not what some checkout on this box last fetched.
 *
 * A network failure is reported as unverified, never as agreement. A check
 * that reports success because it could not look is worse than no check.
 *
 *   npx tsx scripts/check-template.ts
 *   TEMPLATE_REPO=your-org/other npx tsx scripts/check-template.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TEMPLATE_FILES } from '../lib/template-manifest';
import { logRun, guardSync } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';

const REPO = process.env.TEMPLATE_REPO ?? 'your-org/pedia-template';
const BRANCH = process.env.TEMPLATE_BRANCH ?? 'main';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** Normalise line endings only. Whitespace differences are real differences. */
const norm = (s: string): string => s.replace(/\r\n/g, '\n');

async function remoteFile(p: string, token: string): Promise<string | null | 'error'> {
  const url = `https://api.github.com/repos/${REPO}/contents/${p}?ref=${BRANCH}`;
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github.raw', 'user-agent': 'yourpedia-check-template' },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404) return null;      // absent, which is a real finding
    if (!res.ok) return 'error';
    return await res.text();
  } catch {
    return 'error';
  }
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('[check-template] GITHUB_TOKEN not set; cannot read the template. Not treating that as agreement.');
    logRun('check-template', { status: 'error', items: 0, error: 'GITHUB_TOKEN not set' });
    process.exitCode = 1;
    return;
  }

  const missing: string[] = [];
  const drifted: string[] = [];
  const unverified: string[] = [];
  let same = 0;

  const declared: string[] = [];

  for (const f of TEMPLATE_FILES) {
    if (f.diverges) {
      // Present and not compared, on the record: the reason prints every run.
      declared.push(`${f.path}: ${f.diverges}`);
      continue;
    }
    const localPath = path.join(ROOT, f.path);
    if (!fs.existsSync(localPath)) {
      // The manifest names a file this repo no longer has. Stale bookkeeping
      // is how the template rotted in the first place.
      drifted.push(`${f.path}: listed in the manifest but missing HERE`);
      continue;
    }
    let local = norm(fs.readFileSync(localPath, 'utf-8'));
    for (const [ours, theirs] of f.rename ?? []) local = local.split(ours).join(theirs);
    const remote = await remoteFile(f.path, token);

    if (remote === 'error') { unverified.push(f.path); continue; }
    if (remote === null) { missing.push(f.path); continue; }
    if (norm(remote) === local) { same++; continue; }
    drifted.push(`${f.path}: here ${sha(local)}, template ${sha(norm(remote))}`);
  }

  const problems = missing.length + drifted.length;
  console.log(
    `[check-template] ${TEMPLATE_FILES.length} shared files vs ${REPO}@${BRANCH}: ` +
    `${same} identical, ${drifted.length} drifted, ${missing.length} absent there, ${unverified.length} UNVERIFIED, ${declared.length} declared divergent`,
  );
  for (const d of declared) console.log(`  DIVERGES    ${d}`);
  for (const m of missing) console.error(`  ABSENT      ${m}  (${TEMPLATE_FILES.find(f => f.path === m)?.why})`);
  for (const d of drifted) console.error(`  DRIFTED     ${d}`);
  for (const u of unverified) console.error(`  UNVERIFIED  ${u}  (GitHub did not answer; this is not agreement)`);

  logRun('check-template', { status: problems || unverified.length ? 'error' : 'success', items: TEMPLATE_FILES.length });

  if (problems) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  guardSync('check-template', main).catch(e => { console.error(e); process.exitCode = 1; });
}
