/**
 * The NEAR standards (lib/neps.ts) into nep_standards, from one tree
 * listing of near/NEPs and each file's raw text (raw.githubusercontent.com,
 * outside the API quota). A standard whose text changed after the first
 * run goes to change_events.
 *
 * Never deletes: a NEP is a published standard, and one retired upstream is
 * moved to Final/Retired or archive/, not erased.
 *
 *   npx tsx scripts/sync-neps.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { SITE } from '../lib/site.config';
import { politeGetJson, politeGetText } from '../lib/polite-fetch';
import { recordEvents, type ChangeEvent } from '../lib/change-events';
import { NEPS_BRANCH, NEPS_REPO, isNepPath, nepLabel, parseNep, type Nep } from '../lib/neps';

const UA = `${SITE.slug}-sync/1.0 (+${SITE.publisher.url})`;
const MIN_NEPS = 40;

async function main(): Promise<number> {
  const token = process.env.GITHUB_TOKEN;
  const tree = await politeGetJson<{ truncated?: boolean; tree?: Array<{ path: string; type: string }> }>(
    `https://api.github.com/repos/${NEPS_REPO}/git/trees/${NEPS_BRANCH}?recursive=1`,
    { userAgent: UA, timeoutMs: 30_000, headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
  );
  if (!tree?.tree || tree.truncated) throw new Error(`${NEPS_REPO} tree listing ${tree?.truncated ? 'truncated' : 'unavailable'}`);
  const paths = tree.tree.filter((t) => t.type === 'blob' && isNepPath(t.path)).map((t) => t.path);
  if (paths.length < MIN_NEPS) throw new Error(`${NEPS_REPO} lists ${paths.length} NEP files; expected at least ${MIN_NEPS}`);

  const neps: Nep[] = [];
  const failed: string[] = [];
  for (const path of paths) {
    const text = await politeGetText(`https://raw.githubusercontent.com/${NEPS_REPO}/${NEPS_BRANCH}/${path}`, { userAgent: UA, timeoutMs: 30_000 }).catch(() => null);
    const nep = text ? parseNep(path, text) : null;
    if (nep) neps.push(nep);
    else failed.push(path);
  }
  if (neps.length < MIN_NEPS) throw new Error(`only ${neps.length} of ${paths.length} NEP files could be read; nothing written`);
  // Two files can carry one number (a standard and its archived draft):
  // the live one under neps/ wins.
  const byNumber = new Map<number, Nep>();
  for (const n of neps.sort((a, b) => Number(a.archived) - Number(b.archived))) if (!byNumber.has(n.nep)) byNumber.set(n.nep, n);

  const db = getDb();
  const now = new Date().toISOString();
  const stored = new Map((db.prepare('SELECT nep, content_hash FROM nep_standards').all() as Array<{ nep: number; content_hash: string }>).map((r) => [r.nep, r.content_hash]));
  const upsert = db.prepare(`INSERT INTO nep_standards (nep, title, status, type, category, authors, created, replaces, requires, superseded_by, discussion_url, path, url, archived, content_md, content_hash, synced_at)
    VALUES (@nep, @title, @status, @type, @category, @authors, @created, @replaces, @requires, @superseded_by, @discussion_url, @path, @url, @archived, @content_md, @content_hash, @synced_at)
    ON CONFLICT(nep) DO UPDATE SET title = excluded.title, status = excluded.status, type = excluded.type, category = excluded.category, authors = excluded.authors,
      created = excluded.created, replaces = excluded.replaces, requires = excluded.requires, superseded_by = excluded.superseded_by, discussion_url = excluded.discussion_url,
      path = excluded.path, url = excluded.url, archived = excluded.archived, content_md = excluded.content_md, content_hash = excluded.content_hash, synced_at = excluded.synced_at`);
  // A first run, or one after a run that stored too few to be a baseline,
  // records state, not news: otherwise every standard it had missed would
  // arrive as "New standard".
  const events: ChangeEvent[] = stored.size < MIN_NEPS ? [] : [...byNumber.values()].filter((n) => stored.get(n.nep) !== n.content_hash).map((n) => ({
    kind: stored.has(n.nep) ? 'doc_changed' as const : 'doc_added' as const,
    subject: `nep:${n.nep}`,
    title: `${stored.has(n.nep) ? 'Updated' : 'New'} standard: ${nepLabel(n.nep)} ${n.title}${n.status ? ` (${n.status})` : ''}`,
    source_url: n.url,
    key: n.content_hash,
  }));
  db.transaction(() => {
    for (const n of byNumber.values()) {
      upsert.run({ ...n, replaces: JSON.stringify(n.replaces), requires: JSON.stringify(n.requires), superseded_by: JSON.stringify(n.superseded_by), archived: n.archived ? 1 : 0, synced_at: now });
    }
    recordEvents(db, events, now);
  })();
  logRun('neps', { status: failed.length ? 'partial' : 'success', items: byNumber.size, error: failed.length ? `${failed.length} file(s) not read: ${failed.slice(0, 5).join(', ')}` : undefined }, db);
  console.log(`[sync-neps] ${byNumber.size} standards from ${paths.length} files, ${events.length} change events${failed.length ? `, ${failed.length} failed` : ''}`);
  return byNumber.size;
}

if (isEntrypoint(import.meta.url)) {
  guardSync('neps', main).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
