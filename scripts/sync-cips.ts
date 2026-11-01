import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { guardSync } from '../lib/sync-log';
import { parseTableFrontmatter } from '../lib/parsers/cip-frontmatter';
import { rebuildFts } from '../lib/fts';
import { isEntrypoint } from '../lib/is-entrypoint';

const REPO = 'your-org/CIPs';
const BRANCH = 'main';
// Exported so check-completeness.ts counts the same tree this sync reads,
// rather than a second copy of the URL that can drift from it.
export const TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
export const CIP_FILE_RE = /(^|\/)cip-\d+\.md$/;
export const CIP_TEMPLATE_RE = /cip-template\.md$/;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;

// your-org/CIPs uses a Markdown *table* preamble, not YAML/`<pre>` like the
// YourChain template. Each file opens with:
//   | cip | 49 |
//   | - | - |               <- separator row, skipped
//   | title | ... |
//   ...
// followed by a blank line and the Markdown body. We parse the leading run of
// `| key | value |` rows ourselves (the shared lib/parsers/cip-frontmatter.ts
// only understands the YourChain <pre> format).

interface TreeEntry {
  path: string;
  type: string;
}

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'yourpedia-sync',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchTree(): Promise<TreeEntry[]> {
  const res = await fetch(TREE_URL, { headers: ghHeaders() });
  if (!res.ok) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    throw new Error(
      `GitHub tree fetch failed: ${res.status} ${res.statusText}` +
        (remaining === '0' ? ' (rate limited)' : '')
    );
  }
  const json = (await res.json()) as { tree?: TreeEntry[]; truncated?: boolean };
  if (!json.tree) throw new Error('GitHub tree response had no tree array');
  if (json.truncated) console.warn('[warn] GitHub tree response truncated');
  return json.tree;
}

async function fetchRaw(path: string): Promise<string> {
  const res = await fetch(RAW_BASE + path, { headers: ghHeaders() });
  if (!res.ok) {
    throw new Error(`raw fetch failed for ${path}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function syncCips() {
  console.log(`Syncing CIPs from ${REPO}...`);

  const tree = await fetchTree();
  // Match cips/cip-<digits>.md, excluding cip-template.md
  const cipFiles = tree
    .filter((e) => e.type === 'blob' && CIP_FILE_RE.test(e.path))
    .filter((e) => !CIP_TEMPLATE_RE.test(e.path))
    .map((e) => e.path)
    .sort();

  console.log(`Found ${cipFiles.length} CIP files in tree.`);
  if (cipFiles.length === 0) throw new Error('No CIP files matched in repo tree');

  const db = getDb();
  const getExisting = db.prepare('SELECT status FROM cips WHERE id = ?');
  const recordStatusChange = db.prepare(
    `INSERT INTO cip_status_history (cip_id, from_status, to_status, changed_at) VALUES (?, ?, ?, ?)`
  );
  // ON CONFLICT, not INSERT OR REPLACE: REPLACE deletes the row and inserts a
  // fresh one, so every column NOT listed here reverts to its default. That
  // silently wiped tldr and tldr_generated_at on each run - which is why CIP
  // summaries were empty even after a full backfill, since this sync runs every
  // 6 hours. Only the fields we actually fetch are updated now.
  const upsert = db.prepare(`
    INSERT INTO cips
      (id, cip_number, title, author, status, type, created_date, approved_date, license, requires, content_md, synced_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      cip_number = excluded.cip_number,
      title = excluded.title,
      author = excluded.author,
      status = excluded.status,
      type = excluded.type,
      created_date = excluded.created_date,
      approved_date = excluded.approved_date,
      license = excluded.license,
      requires = excluded.requires,
      content_md = excluded.content_md,
      synced_at = excluded.synced_at
  `);

  const now = new Date().toISOString();
  let synced = 0;
  let skipped = 0;

  // Fetch all raw files first (network), then write in one transaction.
  const parsed: Array<{
    id: string;
    cipInt: number;
    title: string | null;
    author: string | null;
    status: string | null;
    type: string | null;
    created: string | null;
    requires: string | null;
    content: string;
  }> = [];

  for (const path of cipFiles) {
    const fileMatch = path.match(/cip-(\d+)\.md$/);
    if (!fileMatch) {
      skipped++;
      continue;
    }
    let content: string;
    try {
      content = await fetchRaw(path);
    } catch (err) {
      console.warn(`[warn] ${path}: ${(err as Error).message} - skipping`);
      skipped++;
      continue;
    }

    const { meta } = parseTableFrontmatter(content);

    // Prefer the `cip` number from frontmatter; fall back to the filename.
    const cipFromMeta = meta['cip'] ? parseInt(meta['cip'].replace(/[^\d]/g, ''), 10) : NaN;
    const cipInt = Number.isFinite(cipFromMeta) ? cipFromMeta : parseInt(fileMatch[1], 10);
    const id = String(cipInt).padStart(4, '0');

    if (Object.keys(meta).length === 0) {
      console.warn(`[warn] ${path}: no table frontmatter found, metadata will be null`);
    }

    const headingTitle =
      content.match(/^#{1,3}\s+(?:CIP-\d+[:\s]+)?(.+)$/m)?.[1]?.trim() ?? null;

    parsed.push({
      id,
      cipInt,
      title: meta['title'] ?? headingTitle,
      author: meta['author'] ?? null,
      status: meta['status'] ?? null,
      type: meta['type'] ?? null,
      created: meta['created'] ?? null,
      requires: meta['requires'] ?? null,
      content,
    });
  }

  const runAll = db.transaction(() => {
    for (const p of parsed) {
      const existing = getExisting.get(p.id) as { status: string | null } | undefined;
      if (existing && p.status && existing.status !== p.status) {
        recordStatusChange.run(p.id, existing.status, p.status, now);
      } else if (!existing && p.status) {
        recordStatusChange.run(p.id, null, p.status, now);
      }

      upsert.run(
        p.id,
        p.cipInt,
        p.title,
        p.author,
        p.status,
        p.type,
        p.created,
        null, // approved_date - not present in YourChain frontmatter
        null, // license - not present in YourChain frontmatter
        p.requires,
        p.content,
        now
      );
      synced++;
    }
  });

  runAll();

  db.prepare(
    `INSERT INTO sync_log (source, status, items_synced, ran_at) VALUES (?, ?, ?, ?)`
  ).run('cips', 'success', synced, now);

  console.log(`Done: ${synced} CIPs synced, ${skipped} skipped.`);

  rebuildFts();
  console.log('FTS5 index rebuilt');
}

// isEntrypoint, not a bare call: check-completeness.ts imports TREE_URL and
// the CIP-matching regexes above so its own completeness count reads the
// same source this sync does. Without this guard, that import ran the whole
// sync against the live database - discovered empirically on 2026-08-02
// when check-completeness.ts's first run did exactly that.
if (isEntrypoint(import.meta.url)) {
  guardSync('cips', syncCips).catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
  });
}
