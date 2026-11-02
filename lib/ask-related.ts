/**
 * The passages of the meaning index closest to an /ask question: the same
 * hybrid search and rerank semantic_search runs, read back through
 * chunkSource. This is what lets /ask answer from the forum, the blogs, the
 * videos and GitHub issues, not only from docs and the structured tables.
 *
 * Docs pages are left out: buildAskContext already reads them by full-text
 * search, and a second copy would only crowd the prompt. If the embedding
 * provider fails the search falls back to words, as semantic_search does;
 * if everything fails /ask still answers from its other sources. A
 * third-party blog post reaches the model as an excerpt only, as it is served.
 */

import type Database from 'better-sqlite3';
import { embedText } from './embeddings';
import { hybridSearch } from './vector-store';
import { rerank } from './reranker';
import { chunkSource } from './chunk-source';
import type { RelatedPassage } from './ask';

const POOL = 30;
const PASSAGES = 4;
const PASSAGE_CHARS = 1200;
const EXCERPT_CHARS = 500;

export async function relatedPassages(db: Database.Database, question: string, limit = PASSAGES): Promise<RelatedPassage[]> {
  let vector: number[] | null = null;
  try {
    vector = await embedText(question);
  } catch {
    vector = null;
  }
  try {
    const pool = hybridSearch(vector, question, POOL).filter((c) => c.sourceType !== 'doc_page');
    const top = await rerank(question, pool, limit);
    return top.flatMap((c) => {
      const src = chunkSource(db, c);
      if (!src.title) return [];
      return [{ kind: src.meta || c.sourceType, title: src.title, url: src.url || null, as_of: src.as_of, text: c.chunkText.trim().slice(0, src.excerptOnly ? EXCERPT_CHARS : PASSAGE_CHARS) }];
    });
  } catch {
    return [];
  }
}
