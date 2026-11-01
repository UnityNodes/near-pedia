import { getDb } from '../lib/db';

const db = getDb();
console.log(`DB initialized at ${db.name}`);
