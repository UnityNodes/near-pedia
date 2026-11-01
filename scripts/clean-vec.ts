import { getDb } from '../lib/db';
const db = getDb();
db.prepare("DROP TABLE IF EXISTS embedding_vectors").run();
db.prepare("CREATE VIRTUAL TABLE embedding_vectors USING vec0(embedding FLOAT[1536])").run();
console.log('Reset OK');
