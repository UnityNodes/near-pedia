/**
 * Index the asset files that ship alongside NEAR CIPs.
 *
 * your-org/CIPs keeps diagrams under cips/assets/cip-<n>/, referenced from
 * the CIP markdown. get_cip_attachments and /api/v1/cips/:id/attachments have
 * always advertised these, but nothing populated cip_attachments, so both
 * answered "none" for every CIP - including the three that do have figures.
 *
 * Only files actually present in the repo tree are recorded; no content is
 * inferred. Binary assets have no extractable text, so content_text stays NULL
 * rather than being filled with a placeholder.
 */
import 'dotenv/config';
import { getDb } from '../lib/db';
import { guardSync } from '../lib/sync-log';
import { prune } from '../lib/prune';
import { pruneConfirmingUrls } from '../lib/confirm-gone';
import { isoNowSql } from '../lib/formats';
import { SITE } from '../lib/site.config';

const REPO = 'your-org/CIPs';
const TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`;
const ASSET_PREFIX = 'cips/assets/';

interface TreeEntry { path?: string; type?: string; size?: number }

/** cips/assets/cip-15/memo-length.svg -> "0015" (matches cips.id padding) */
function cipIdFromPath(path: string): string | null {
  const m = path.slice(ASSET_PREFIX.length).match(/^cip-(\d+)\//i);
  return m ? m[1].padStart(4, '0') : null;
}

async function main(): Promise<number> {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS cip_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cip_id TEXT NOT NULL REFERENCES cips(id),
    filename TEXT NOT NULL,
    github_url TEXT NOT NULL UNIQUE,
    raw_url TEXT NOT NULL,
    content_text TEXT,
    pages INTEGER,
    synced_at TEXT)`);

  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(TREE_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      'User-Agent': `${SITE.name}-Bot/1.0`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`[sync-cip-assets] tree fetch failed: HTTP ${res.status}`);
  }
  const tree = ((await res.json()) as { tree?: TreeEntry[] }).tree ?? [];
  if (tree.length === 0) {
    throw new Error('[sync-cip-assets] empty tree - refusing to prune against a bad fetch');
  }

  const assets = tree.filter(
    (f) => f.type === 'blob' && typeof f.path === 'string' && f.path.startsWith(ASSET_PREFIX),
  );

  // Only attach to CIPs we actually have: the FK would otherwise dangle.
  const known = new Set(
    (db.prepare('SELECT id FROM cips').all() as Array<{ id: string }>).map((r) => r.id),
  );

  const ins = db.prepare(`INSERT INTO cip_attachments
    (cip_id, filename, github_url, raw_url, content_text, pages, synced_at)
    VALUES (?,?,?,?,NULL,NULL,${isoNowSql()})
    ON CONFLICT(github_url) DO UPDATE SET
      cip_id = excluded.cip_id, filename = excluded.filename,
      raw_url = excluded.raw_url, synced_at = excluded.synced_at`);

  const seen: string[] = [];
  let skipped = 0;
  for (const f of assets) {
    const path = f.path as string;
    const cipId = cipIdFromPath(path);
    if (!cipId || !known.has(cipId)) { skipped++; continue; }
    const githubUrl = `https://github.com/${REPO}/blob/main/${path}`;
    const rawUrl = `https://raw.githubusercontent.com/${REPO}/main/${path}`;
    ins.run(cipId, path.split('/').pop(), githubUrl, rawUrl);
    seen.push(githubUrl);
  }

  // Drop rows whose file disappeared upstream. The empty-tree throw above
  // only catches a fully empty response; a truncated (non-empty) tree still
  // needs the ratio guard. github_url is a real, fetchable page (GitHub's
  // blob view 404s cleanly for a removed path), so a large "deletion" is
  // checkable rather than guessed at from the ratio alone - the same class
  // of incident as a doc host renaming a quarter of its pages
  // and the ratio guard read the rename as an outage for eight days. 0.2
  // matches this script's pre-existing (tighter than default) guard.
  const { result, report } = await pruneConfirmingUrls(
    { table: 'cip_attachments', keyColumn: 'github_url', liveKeys: seen, maxDeleteRatio: 0.2 },
    (spec) => prune(spec),
    { userAgent: `${SITE.name}-Bot/1.0`, delayMs: 300 },
  );
  if (report.overCap) {
    console.log(`[sync-cip-assets] ${report.candidates} prune candidate(s) over the probe cap; not confirming, the ratio guard decides alone`);
  } else if (report.confirmed) {
    console.log(`[sync-cip-assets] confirmed ${report.confirmed} of ${report.candidates} candidate(s) gone upstream (404/410)`);
  }
  if (result.refused) {
    console.error(`[sync-cip-assets] REFUSING to prune: ${result.reason}`);
  }
  const pruned = result.deleted;

  // cip_attachments_fts is external-content with no maintenance trigger on
  // this table (checked: none exists), so neither the insert above nor the
  // prune above touch it - every row synced here has sat unindexed since the
  // table was created (check-fts-freshness caught 3 of 3 never indexed).
  // Same fix as sync-blog.ts/sync-papers.ts/sync-youtube.ts: a full rebuild
  // after every run, since this sync is small and infrequent enough that
  // incremental trigger maintenance isn't worth the extra surface.
  try { db.exec("INSERT INTO cip_attachments_fts(cip_attachments_fts) VALUES('rebuild')"); } catch {}

  console.log(
    `[sync-cip-assets] ${assets.length} asset files upstream, ${seen.length} linked` +
    `${skipped ? `, ${skipped} skipped (unknown CIP)` : ''}` +
    `${pruned ? `, ${pruned} pruned` : ''}`,
  );
  return seen.length;
}

guardSync('cip-assets', main).catch((e) => { console.error(e); process.exit(1); });
