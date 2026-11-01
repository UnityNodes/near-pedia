/**
 * Does the vector index still hold the text its source row holds?
 *
 * WHY THIS IS NOT COVERED BY THE OTHER CHECKS. Every existing check asks
 * whether a row is right, whether a count is a total, whether a tool prints
 * what the table says. None of them asks whether the COPY of that row inside
 * embedding_chunks still matches it. It is a copy: build-embeddings splits each
 * document into chunks, embeds them, and from then on semantic_search answers
 * out of the copy and prints a title and a URL fetched fresh from the row. So a
 * chunk can go stale and every visible signal stays correct - the title is
 * current, the URL resolves, the count is right, and the words in between are
 * the words of an older version of the document.
 *
 * WHY IT CAN BE PERMANENT. build-embeddings gates re-embedding on a content
 * hash in embedding_doc_hash: hash differs, drop the chunks and rebuild. The
 * gate is only as good as the hash, and the hash is SEEDED - on first sight of
 * a document there is nothing to compare against, so the current text is
 * recorded as-is and whatever chunks already exist are left alone. Any state
 * where chunks exist and the hash row does not is therefore a state where
 * stale text becomes permanent on the next run, silently, and the gate then
 * reports it as current forever. deleteSourceEmbeddings used to make exactly
 * that state reachable by deleting the hash outside the transaction that
 * deleted the chunks; it no longer does, and this check is what proves the
 * class stays closed rather than that one instance was fixed.
 *
 * WHAT IT COMPARES. The loader from build-embeddings (the definition of what a
 * document IS, imported rather than re-implemented so the two cannot drift)
 * against the chunk rows the index actually holds. Two sides, two sources.
 *
 * WHAT IS NORMAL. A document whose hash no longer matches its text is work the
 * next embed run will do - churn, not drift, and reported as such. The finding
 * is the other cell: text that does not match while the hash says it does,
 * which no run will ever revisit.
 *
 *   npx tsx scripts/check-index-freshness.ts
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { chunkText, hashContent } from '../lib/vector-store';
import { loadAllDocs } from './build-embeddings';

/** Reported, not failed: an unreadable diff is worth more than a bare count. */
function describe(kind: 'count' | 'text', have: string[], want: string[]): string {
  if (kind === 'count') return `holds ${have.length} chunk(s), the current text makes ${want.length}`;
  for (let i = 0; i < Math.min(have.length, want.length); i++) {
    if (have[i] === want[i]) continue;
    const h = have[i], w = want[i];
    // Name the cheapest explanation first: a line-ending change rewrites every
    // chunk of a document while changing none of its words, and reads as
    // catastrophic drift until you look.
    if (h.replace(/\r\n/g, '\n') === w.replace(/\r\n/g, '\n')) {
      return `chunk ${i} differs only in line endings (indexed ${h.includes('\r\n') ? 'CRLF' : 'LF'}, row now ${w.includes('\r\n') ? 'CRLF' : 'LF'})`;
    }
    const common = [...h].findIndex((c, j) => c !== w[j]);
    return `chunk ${i} differs from character ${common < 0 ? Math.min(h.length, w.length) : common}: indexed ${JSON.stringify(h.slice(Math.max(0, common - 20), common + 60))}, row has ${JSON.stringify(w.slice(Math.max(0, common - 20), common + 60))}`;
  }
  return `chunk boundaries differ`;
}

async function main(): Promise<void> {
  const db = getDb();
  const started = Date.now();

  const docs = loadAllDocs();
  const hashes = new Map<string, string>();
  for (const r of db.prepare('SELECT source_type, source_id, content_hash FROM embedding_doc_hash').all() as Array<{ source_type: string; source_id: string; content_hash: string }>) {
    hashes.set(`${r.source_type}\u0000${r.source_id}`, r.content_hash);
  }

  const stored = new Map<string, string[]>();
  for (const r of db.prepare('SELECT source_type, source_id, chunk_index, chunk_text FROM embedding_chunks').all() as Array<{ source_type: string; source_id: string; chunk_index: number; chunk_text: string }>) {
    const k = `${r.source_type}\u0000${r.source_id}`;
    let list = stored.get(k);
    if (!list) { list = []; stored.set(k, list); }
    list[r.chunk_index] = r.chunk_text;
  }

  const stale: string[] = [];
  let pending = 0;   // hash says changed: the next run rebuilds these
  let compared = 0;

  for (const d of docs) {
    const k = `${d.sourceType}\u0000${d.sourceId}`;
    const have = stored.get(k);
    if (!have || have.length === 0) continue;      // not embedded yet; not this check's question

    const storedHash = hashes.get(k);
    const currentHash = hashContent(d.text);
    if (storedHash !== undefined && storedHash !== currentHash) { pending++; continue; }

    compared++;
    const want = chunkText(d.text, d.chunkSize ?? 3200, d.overlap ?? 400);
    if (have.length !== want.length) {
      stale.push(`${d.sourceType}/${d.sourceId}: ${describe('count', have, want)}`);
      continue;
    }
    let differs = false;
    for (let i = 0; i < want.length; i++) if (have[i] !== want[i]) { differs = true; break; }
    if (differs) stale.push(`${d.sourceType}/${d.sourceId}: ${describe('text', have, want)}`);
  }

  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `[check-index-freshness] ${compared} document(s) compared against the index in ${secs}s, ` +
    `${pending} awaiting a rebuild the hash has already asked for, ${stale.length} stale`,
  );
  for (const s of stale.slice(0, 25)) console.error(`  STALE   ${s}`);
  if (stale.length > 25) console.error(`  ... and ${stale.length - 25} more`);
  if (stale.length) {
    console.error('  these hold text their row no longer holds AND a hash that says they are current,');
    console.error('  so no build-embeddings run will revisit them: re-embed by source, or --force');
  }

  logRun('check-index-freshness', {
    status: stale.length ? 'partial' : 'success',
    items: compared,
    error: stale.length ? stale.join(' ; ').slice(0, 1000) : undefined,
  }, db);

  if (stale.length) process.exitCode = 1;
}

main().catch(err => {
  console.error('check-index-freshness failed:', err);
  logRun('check-index-freshness', { status: 'error', error: String(err).slice(0, 500) });
  process.exit(1);
});
