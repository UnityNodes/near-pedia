import { getDb } from './db';
import { getCips } from './cips';
import { getDocs } from './docs';
import type { GlossaryEntry } from './glossary';

export interface TermMentions {
  query: string;
  cips: number;
  docs: number;
}

export function mentionQuery(term: string): string {
  return `"${term.replace(/\s*\([^)]*\)\s*$/, '').replace(/"/g, '').trim()}"`;
}

let cache: { key: string; value: Record<string, TermMentions> } | null = null;

function corpusStamp(): string {
  const row = getDb().prepare(
    `SELECT (SELECT COUNT(*) || ':' || COALESCE(MAX(synced_at), '') FROM cips) || '|' ||
            (SELECT COUNT(*) || ':' || COALESCE(MAX(synced_at), '') FROM doc_pages) AS k`,
  ).get() as { k: string };
  return row.k;
}

export function getGlossaryMentions(entries: readonly Pick<GlossaryEntry, 'id' | 'term'>[], glossaryStamp = ''): Record<string, TermMentions> {
  const key = `${glossaryStamp}#${corpusStamp()}#${entries.map(e => `${e.id}=${e.term}`).join(',')}`;
  if (cache && cache.key === key) return cache.value;
  const value: Record<string, TermMentions> = {};
  for (const e of entries) {
    const query = mentionQuery(e.term);
    value[e.id] = {
      query,
      cips: getCips({ q: query, kind: 'cip', perPage: 1 }).total,
      docs: getDocs({ q: query, perPage: 1 }).total,
    };
  }
  cache = { key, value };
  return value;
}
