import { getDb } from '../lib/db';
const db = getDb();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log(tables);
