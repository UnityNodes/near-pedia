import { getDb } from '../lib/db';

const db = getDb();

const deleted1 = db.prepare(
  "DELETE FROM doc_pages WHERE content_text LIKE '%http-equiv%refresh%'"
).run();

const deleted2 = db.prepare(
  "DELETE FROM doc_pages WHERE content_html IS NULL AND (content_text IS NULL OR LENGTH(TRIM(content_text)) < 30)"
).run();

console.log('Deleted redirect pages:', deleted1.changes);
console.log('Deleted empty pages:', deleted2.changes);

db.prepare("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')").run();
console.log('FTS rebuilt');
