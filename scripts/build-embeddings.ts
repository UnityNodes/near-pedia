import { config } from "dotenv";
config({ path: ".env.local" });

import { getDb } from '../lib/db';
import { guardSync } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { embedBatch } from '../lib/embeddings';
import { KIND_SQL } from '../lib/blog';
import {
  upsertChunk, upsertVector, getChunkId, hasEmbedding, chunkText,
  hashContent, getDocHash, setDocHash, deleteSourceEmbeddings,
} from '../lib/vector-store';

const BATCH_SIZE = 50;
const RATE_LIMIT_DELAY_MS = 5000;
const BATCH_INTERVAL_MS = 3000;
// --force re-embeds every source from scratch (drops all chunks/vectors and
// rebuilds). Without it, only new or content-changed sources are (re)embedded.
const FORCE = process.argv.includes('--force');

interface SourceDoc {
  sourceType: string;
  sourceId: string;
  text: string;
  chunkSize?: number;
  overlap?: number;
}

export function loadAllDocs(): SourceDoc[] {
  const db = getDb();
  const docs: SourceDoc[] = [];

  const cips = db.prepare(
    'SELECT id, title, content_md FROM cips WHERE content_md IS NOT NULL'
  ).all() as { id: string; title: string; content_md: string }[];
  for (const c of cips) {
    docs.push({ sourceType: 'cip', sourceId: c.id, text: `${c.title}\n\n${c.content_md}` });
  }

  const topics = db.prepare(
    `SELECT t.id, t.title, GROUP_CONCAT(p.cooked, ' ') as posts
     FROM forum_topics t LEFT JOIN forum_posts p ON p.topic_id = t.id
     GROUP BY t.id`
  ).all() as { id: number; title: string; posts: string | null }[];
  for (const t of topics) {
    const text = [t.title, t.posts ?? ''].filter(Boolean).join('\n\n');
    if (text.trim()) docs.push({ sourceType: 'forum_topic', sourceId: String(t.id), text, chunkSize: 2400, overlap: 320 });
  }

  try {
    const blogs = db.prepare(
      `SELECT id, title, content_text FROM blog_posts WHERE content_text IS NOT NULL AND ${KIND_SQL} != 'release'`
    ).all() as { id: string; title: string; content_text: string }[];
    for (const b of blogs) {
      docs.push({ sourceType: 'blog_post', sourceId: b.id, text: `${b.title}\n\n${b.content_text}` });
    }
  } catch {
    console.warn('blog_posts table not available, skipping');
  }

  try {
    const items = db.prepare(
      "SELECT id, title, body FROM github_items WHERE body IS NOT NULL AND body != ''"
    ).all() as { id: string; title: string; body: string }[];
    for (const it of items) {
      docs.push({ sourceType: 'github_item', sourceId: it.id, text: `${it.title}\n\n${it.body}` });
    }
  } catch {
    console.warn('github_items table not available, skipping');
  }

  try {
    const docPages = db.prepare(
      'SELECT id, title, content_text FROM doc_pages WHERE content_text IS NOT NULL'
    ).all() as { id: number; title: string; content_text: string }[];
    for (const d of docPages) {
      docs.push({ sourceType: 'doc_page', sourceId: String(d.id), text: `${d.title}\n\n${d.content_text}` });
    }
  } catch {
    console.warn('doc_pages table not available, skipping');
  }

  try {
    const whitepapers = db.prepare(
      'SELECT id, title, content_text FROM whitepapers WHERE content_text IS NOT NULL'
    ).all() as { id: number; title: string; content_text: string }[];
    for (const w of whitepapers) {
      docs.push({ sourceType: 'whitepaper', sourceId: String(w.id), text: `${w.title}\n\n${w.content_text}` });
    }
  } catch {
    console.warn('whitepapers table not available, skipping');
  }

  // YouTube videos (title + description, transcript if available)
  try {
    const videos = db.prepare(
      'SELECT id, title, description, transcript_text FROM youtube_videos WHERE title IS NOT NULL'
    ).all() as { id: string; title: string; description: string | null; transcript_text?: string | null }[];
    for (const v of videos) {
      const text = [v.title, v.description, v.transcript_text].filter(Boolean).join('\n\n');
      if (text.length > 30) docs.push({ sourceType: 'youtube_video', sourceId: v.id, text });
    }
  } catch {
    console.warn('youtube_videos table not available, skipping');
  }

  // GitHub releases
  try {
    const releases = db.prepare(
      'SELECT id, name, tag, body, repo FROM github_releases WHERE published_at IS NOT NULL'
    ).all() as { id: string; name: string | null; tag: string; body: string | null; repo: string }[];
    for (const r of releases) {
      const text = [r.name ?? r.tag, r.repo, r.body].filter(Boolean).join('\n\n');
      if (text.length > 10) docs.push({ sourceType: 'github_release', sourceId: r.id, text });
    }
  } catch {
    console.warn('github_releases table not available, skipping');
  }

  // Ecosystem projects
  try {
    const eco = db.prepare(
      'SELECT slug, title, description, tags FROM ecosystem_projects WHERE description IS NOT NULL'
    ).all() as { slug: string; title: string; description: string; tags: string | null }[];
    for (const e of eco) {
      const text = [e.title, e.description, e.tags].filter(Boolean).join('\n\n');
      if (text.length > 10) docs.push({ sourceType: 'ecosystem_project', sourceId: e.slug, text });
    }
  } catch {
    console.warn('ecosystem_projects table not available, skipping');
  }

  // GitHub Discussions (with top comments)
  try {
    const discussions = db.prepare(
      'SELECT id, repo, title, body, category, comments_json FROM github_discussions WHERE body IS NOT NULL'
    ).all() as { id: string; repo: string; title: string; body: string; category: string | null; comments_json: string | null }[];
    for (const d of discussions) {
      let commentsText = '';
      try {
        const comments = d.comments_json ? JSON.parse(d.comments_json) as Array<{author?: string; body: string}> : [];
        commentsText = comments.slice(0, 10).map(c => `${c.author ?? 'anon'}: ${c.body}`).join('\n\n');
      } catch { /* malformed JSON */ }
      const text = [
        `${d.repo} discussion: ${d.title}`,
        d.category ? `Category: ${d.category}` : null,
        d.body,
        commentsText ? `\n--- Comments ---\n${commentsText}` : null,
      ].filter(Boolean).join('\n\n');
      if (text.length > 30) {
        docs.push({ sourceType: 'github_discussion', sourceId: d.id, text, chunkSize: 2400, overlap: 320 });
      }
    }
  } catch {
    console.warn('github_discussions table not available, skipping');
  }

  // Foundation Curated KB (your-org/build-on-yourchain-mcp, attribution preserved)
  try {
    const fkb = db.prepare(
      'SELECT id, category, title, content FROM foundation_kb WHERE content IS NOT NULL'
    ).all() as { id: number; category: string; title: string; content: string }[];
    for (const r of fkb) {
      const text = `[${r.category}] ${r.title}\n\n${r.content}`;
      docs.push({ sourceType: 'foundation_kb', sourceId: String(r.id), text });
    }
  } catch {
    console.warn('foundation_kb table not available, skipping');
  }

  // Radar items (ecosystem signals / advisories)
  try {
    const radar = db.prepare(
      "SELECT id, title, body, level FROM radar_items WHERE body IS NOT NULL AND body != ''"
    ).all() as { id: number; title: string; body: string; level: string | null }[];
    for (const r of radar) {
      const text = [r.level ? `[${r.level}]` : null, r.title, r.body].filter(Boolean).join('\n\n');
      if (text.length > 30) docs.push({ sourceType: 'radar_item', sourceId: String(r.id), text });
    }
  } catch {
    console.warn('radar_items table not available, skipping');
  }

  // SDK versions (registry release records)

  return docs;
}

interface PendingChunk {
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  chunkText: string;
  chunkId: number;
}

// Nothing pruned embeddings for rows that were deleted. The pass below only
// visits documents that still exist, so a chunk whose source row is gone is
// never looked at again and keeps answering semantic queries forever. The
// release and blog syncs now delete what upstream dropped, which would otherwise
// leave those chunks in the index as content with no working citation.
//
// Only sweeps source types that loaded this run. loadAllDocs wraps some tables
// in try/catch and skips them on failure, so sweeping a type that simply failed
// to load would delete every chunk it has.
function pruneOrphanChunks(docs: SourceDoc[]): number {
  const db = getDb();
  const live = new Map<string, Set<string>>();
  for (const d of docs) {
    if (!live.has(d.sourceType)) live.set(d.sourceType, new Set());
    live.get(d.sourceType)!.add(d.sourceId);
  }

  let removed = 0;
  for (const [sourceType, ids] of live) {
    const stored = db.prepare(
      'SELECT DISTINCT source_id FROM embedding_chunks WHERE source_type = ?',
    ).all(sourceType) as Array<{ source_id: string }>;
    for (const { source_id } of stored) {
      if (ids.has(source_id)) continue;
      removed += deleteSourceEmbeddings(sourceType, source_id);
    }
  }
  return removed;
}

async function main() {
  // Check the credential BEFORE anything destructive. The loop below deletes the
  // stale vectors of every changed document first and only then calls the
  // embedding API, so a missing key would empty part of the index and then fail.
  if (!process.env.NEARAI_API_KEY?.trim()) {
    console.error('NEARAI_API_KEY is not set. Refusing to start: this script deletes stale');
    console.error('vectors before it embeds anything, so running without a key would empty');
    console.error('part of the index and then fail. Source the environment first:');
    console.error('  set -a; . ./.env.production; set +a');
    process.exit(1);
  }

  console.log('Loading documents...');
  const docs = loadAllDocs();
  console.log(`Loaded ${docs.length} documents`);

  const orphaned = pruneOrphanChunks(docs);
  if (orphaned > 0) console.log(`Pruned ${orphaned} chunk(s) whose source row no longer exists`);

  const pending: PendingChunk[] = [];
  let changed = 0;

  for (const doc of docs) {
    const curHash = hashContent(doc.text);
    const storedHash = getDocHash(doc.sourceType, doc.sourceId);

    // Content changed since last embed (or --force): drop stale chunks+vectors
    // so they get rebuilt below. On first run storedHash is null → no delete,
    // so we seed hashes off the existing corpus instead of re-embedding ~40k
    // chunks (and incurring that OpenAI cost) on deploy.
    if (FORCE || (storedHash !== null && storedHash !== curHash)) {
      const removed = deleteSourceEmbeddings(doc.sourceType, doc.sourceId);
      if (removed > 0) changed++;
    }

    const chunks = chunkText(doc.text, doc.chunkSize ?? 3200, doc.overlap ?? 400);
    for (let i = 0; i < chunks.length; i++) {
      upsertChunk({ sourceType: doc.sourceType, sourceId: doc.sourceId, chunkIndex: i, chunkText: chunks[i] });
      const chunkId = getChunkId({ sourceType: doc.sourceType, sourceId: doc.sourceId, chunkIndex: i });
      if (chunkId && !hasEmbedding(chunkId)) {
        pending.push({ sourceType: doc.sourceType, sourceId: doc.sourceId, chunkIndex: i, chunkText: chunks[i], chunkId });
      }
    }
    // Record the hash now. The "embed any chunk lacking a vector" pass below is
    // independent of this, so a crash mid-embed still self-heals on next run.
    setDocHash(doc.sourceType, doc.sourceId, curHash);
  }
  if (changed > 0) console.log(`${changed} source(s) changed - stale chunks dropped for re-embed${FORCE ? ' (forced)' : ''}`);

  console.log(`${pending.length} chunks need embedding`);
  if (pending.length === 0) {
    console.log('All chunks already embedded. Done.');
    return 0;
  }

  let embedded = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    let embeddings: number[][];
    let retries = 0;
    while (true) {
      try {
        embeddings = await embedBatch(batch.map(c => c.chunkText));
        break;
      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        if (status === 429 && retries < 10) {
          retries++;
          const wait = RATE_LIMIT_DELAY_MS * retries;
          process.stdout.write(`\n429 rate limit - waiting ${Math.round(wait / 1000)}s (retry ${retries})...\n`);
          await new Promise(r => setTimeout(r, wait));
        } else {
          throw err;
        }
      }
    }
    for (let j = 0; j < batch.length; j++) {
      upsertVector(batch[j].chunkId, embeddings![j]);
    }
    embedded += batch.length;
    process.stdout.write(`\rEmbedded ${embedded}/${pending.length} chunks...`);
    if (i + BATCH_SIZE < pending.length) {
      await new Promise(r => setTimeout(r, BATCH_INTERVAL_MS));
    }
  }

  console.log('\nDone.');
  return embedded;
}

// Not a bare call: check-index-freshness.ts imports loadAllDocs above so its
// own read matches the definition this file uses, rather than a second copy
// that can drift from it. Without this guard, that import ran the whole embed
// pipeline (including live OpenAI calls) against the live database as a side
// effect of importing one function - discovered empirically while porting
// check-index-freshness.ts, the same way check-completeness.ts's own SRC
// import once ran sync-ecosystem.ts's full sync by accident.
if (isEntrypoint(import.meta.url)) {
  guardSync('embeddings', main).catch(err => { console.error(err); process.exit(1); });
}
