import { getDb } from '../lib/db';
const db = getDb();
const sources = db.prepare("SELECT source_type, COUNT(*) as c FROM embedding_chunks GROUP BY source_type ORDER BY c DESC").all();
console.log('RAG sources:', sources);
