import { getDb } from '../lib/db';
import { DIMENSIONS } from '../lib/embedding-dims';
const db = getDb();
db.prepare("DROP TABLE IF EXISTS embedding_vectors").run();
db.prepare(`CREATE VIRTUAL TABLE embedding_vectors USING vec0(embedding FLOAT[${DIMENSIONS}])`).run();
console.log('Reset OK');
