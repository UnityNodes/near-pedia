import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDb } from '@/lib/db';
import { unifiedSearch } from '@/lib/search';

describe('unifiedSearch with punctuation in the query', () => {
  beforeEach(() => {
    resetDb();
    const db = getDb();
    db.prepare("INSERT INTO doc_pages (id, url, title, content_text, source, synced_at) VALUES (1, 'https://docs.near.org/x', 'Issuance', 'The issuance ramp to 1.6 percent', 'docs', 't')").run();
    db.exec("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')");
  });

  it('treats % $ # ? & and friends as spaces instead of failing the full-text query', () => {
    for (const q of ['issuance 1.6%', 'issuance? #1.6', 'issuance & $1.6', 'issuance/1.6;']) {
      expect(unifiedSearch(q, 5).results.map((r) => r.id)).toContain('1');
    }
  });
});
