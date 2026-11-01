import { getDb } from '../lib/db';
const db = getDb();
db.prepare("DROP TABLE IF EXISTS embedding_vectors").run();
db.prepare("CREATE VIRTUAL TABLE embedding_vectors USING vec0(embedding FLOAT[1536])").run();
const v = db.prepare("SELECT sql FROM sqlite_master WHERE name='embedding_vectors'").get();
console.log(v);
