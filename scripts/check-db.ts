import { getDb } from '../lib/db';

const db = getDb();
const chunks = db.prepare('SELECT COUNT(*) as c FROM embedding_chunks').get() as { c: number };
const vecs = db.prepare('SELECT COUNT(*) as c FROM embedding_vectors').get() as { c: number };
console.log('Chunks:', chunks.c);
console.log('Vectors:', vecs.c);

const sample = db.prepare('SELECT * FROM embedding_chunks LIMIT 2').all();
console.log('Sample chunks:', JSON.stringify(sample).slice(0, 300));
