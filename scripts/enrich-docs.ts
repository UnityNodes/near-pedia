/**
 * Enrich the template doc_pages with the richer NEAR content that the
 * initial migration left behind (template has no repo_docs/adrs/rpc tables):
 * fold repo_docs + adrs + rpc_methods into doc_pages as additional sources so
 * they appear on /docs (grouped by source) and in the RAG corpus.
 * Run scripts/build-embeddings.ts afterwards.
 *
 * data/nearpedia.db (SRC) is a static one-time export, not a live sync
 * target - nothing regenerates it. INSERT OR IGNORE means every run after
 * the first inserts 0 rows by construction; this script sitting in the daily
 * cron bucket does not mean the ADR/RPC/repo-doc content refreshes daily.
 * See the notes/bugs/2026-08-01-nearpedia-audit.md.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { marked } from 'marked';
import { guardSync } from '../lib/sync-log';

interface RepoDocRow { repo: string; path: string; title: string | null; content_md: string; url: string | null; synced_at: string | null }
interface AdrRow { repo: string; number: number; title: string | null; status: string | null; content_md: string; url: string | null; synced_at: string | null }
interface RpcMethodRow { name: string; summary: string | null; description: string | null; params_json: string | null; result_json: string | null; url: string | null; synced_at: string | null }

const SRC = '/srv/nearpedia/data/nearpedia.db';
const DEST = path.join(process.cwd(), 'data', 'cips.db');

function main(): number {
const src = new Database(SRC, { readonly: true });
const db = new Database(DEST);
db.pragma('foreign_keys = OFF');

const toText = (md: string) => (md || '').replace(/[#>*`_~\[\]()|-]+/g, ' ').replace(/\s+/g, ' ').trim();
const excerpt = (md: string) => toText(md).slice(0, 200);
const repoSource = (repo: string) => (repo.split('/').pop() || repo).toLowerCase();

const ins = db.prepare(`INSERT OR IGNORE INTO doc_pages
  (url, title, breadcrumb, excerpt, content_text, content_html, source, last_modified, synced_at)
  VALUES (?,?,?,?,?,?,?,?,?)`);

let added = { repo_docs: 0, adrs: 0, rpc: 0 };

// 1. repo_docs → doc_pages (source = short repo name, breadcrumb = path)
{
  const rows = src.prepare('SELECT repo, path, title, content_md, url, synced_at FROM repo_docs WHERE content_md IS NOT NULL').all() as RepoDocRow[];
  const tx = db.transaction((arr: RepoDocRow[]) => {
    for (const r of arr) {
      if (!r.url) continue;
      const html = marked.parse(r.content_md || '') as string;
      const info = ins.run(r.url, r.title || r.path, r.path, excerpt(r.content_md), r.content_md, html, repoSource(r.repo), r.synced_at, r.synced_at);
      added.repo_docs += info.changes;
    }
  });
  tx(rows);
}

// 2. adrs → doc_pages (source = 'adr')
{
  const rows = src.prepare('SELECT repo, number, title, status, content_md, url, synced_at FROM adrs WHERE content_md IS NOT NULL').all() as AdrRow[];
  const tx = db.transaction((arr: AdrRow[]) => {
    for (const r of arr) {
      if (!r.url) continue;
      const title = `ADR-${String(r.number).padStart(3, '0')}: ${r.title || ''}`.trim();
      const html = marked.parse(r.content_md || '') as string;
      const info = ins.run(r.url, title, `${r.repo} · ${r.status || 'ADR'}`, excerpt(r.content_md), r.content_md, html, 'adr', r.synced_at, r.synced_at);
      added.adrs += info.changes;
    }
  });
  tx(rows);
}

// 3. rpc_methods → doc_pages (source = 'rpc', url anchored by method name)
{
  const rows = src.prepare('SELECT name, summary, description, params_json, result_json, url, synced_at FROM rpc_methods').all() as RpcMethodRow[];
  const tx = db.transaction((arr: RpcMethodRow[]) => {
    for (const r of arr) {
      const md = [
        r.summary ? `**${r.summary}**` : '',
        r.description || '',
        r.params_json ? `\n\n**Params:**\n\n\`\`\`json\n${r.params_json}\n\`\`\`` : '',
        r.result_json ? `\n\n**Result:**\n\n\`\`\`json\n${r.result_json}\n\`\`\`` : '',
      ].filter(Boolean).join('\n\n');
      const url = `${r.url || 'https://docs.yourchain.example/how-to-guides/rpc-api'}#${encodeURIComponent(r.name)}`;
      const html = marked.parse(md || r.name) as string;
      const info = ins.run(url, r.name, 'JSON-RPC method', excerpt(md || r.summary || r.name), md, html, 'rpc', r.synced_at, r.synced_at);
      added.rpc += info.changes;
    }
  });
  tx(rows);
}

// rebuild docs FTS to index the new pages
try { db.exec("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')"); } catch (e) { console.log('fts:', (e as Error).message); }

const total = (db.prepare('SELECT COUNT(*) c FROM doc_pages').get() as { c: number }).c;
const bySource = db.prepare('SELECT source, COUNT(*) c FROM doc_pages GROUP BY source ORDER BY c DESC').all();
console.log('Added:', added);
console.log('doc_pages total now:', total);
console.log('by source:', JSON.stringify(bySource));
db.close(); src.close();

// Return rows actually inserted this run, not the running total - nearpedia.db
// is a static one-time snapshot (see header comment), so this is 0 on every
// run after the first. That's the honest number: it's what tells sync_log
// this "sync" cannot produce anything new without a live source behind it.
return added.repo_docs + added.adrs + added.rpc;
}

guardSync('docs-enrich', main).catch(e => { console.error(e); process.exit(1); });
