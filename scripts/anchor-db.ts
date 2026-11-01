/**
 * Once a day: hash the database (lib/db-hash.ts) and record the hash on
 * NEAR in the db-anchor contract (contracts/db-anchor), which keeps one
 * record per date and refuses to change it. The hash and its per-table
 * manifest are kept in db_anchors either way; without an anchor account
 * configured the run is local only and says so.
 *
 * The hash is taken from a VACUUM INTO copy, consistent by construction
 * while syncs keep writing, and the copy is kept SNAPSHOT_DAYS days in
 * ANCHOR_SNAPSHOT_DIR (default data/anchors): that file is what the day's
 * record commits to, and it, or any copy of it, can be checked by anyone:
 *
 *   npx tsx scripts/anchor-db.ts                       hash, store, record on NEAR
 *   npx tsx scripts/anchor-db.ts --dry-run             hash and print, write nothing
 *   npx tsx scripts/anchor-db.ts --verify <db> [date]  recompute a copy's hash, compare with the chain
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Account, JsonRpcProvider, KeyPairSigner } from 'near-api-js';
import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { hashDatabase, type DbHash } from '../lib/db-hash';
import { anchorConfig, chainRecord, type AnchorConfig, type ChainRecord } from '../lib/anchor-chain';
import { repoPath } from '../lib/repo-root';

const SNAPSHOT_DAYS = 14;
const snapshotDir = () => process.env.ANCHOR_SNAPSHOT_DIR?.trim() || repoPath('data', 'anchors');

/** The day's consistent copy: VACUUM INTO writes one snapshot of the live database, whatever the syncs do meanwhile. */
function snapshot(db: Database.Database, date: string): string {
  const dir = snapshotDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${date}.db`);
  fs.rmSync(file, { force: true });
  db.prepare('VACUUM INTO ?').run(file);
  const keep = new Set(Array.from({ length: SNAPSHOT_DAYS }, (_, i) => new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)));
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.db$/);
    if (m && !keep.has(m[1])) fs.rmSync(path.join(dir, f), { force: true });
  }
  return file;
}

/** What is stored and served publicly: the message without URLs, which may carry an RPC key. */
const publicError = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0].replace(/https?:\/\/\S+/g, '<url>').slice(0, 300);

const RECORD_GAS = BigInt('30000000000000');

export async function recordOnChain(cfg: AnchorConfig, date: string, h: DbHash): Promise<{ tx_hash: string; record: ChainRecord }> {
  const account = new Account(cfg.account, new JsonRpcProvider({ url: cfg.rpc }), KeyPairSigner.fromSecretKey(cfg.privateKey as `ed25519:${string}`));
  const out = await account.callFunctionRaw({
    contractId: cfg.contract,
    methodName: 'record',
    args: { date, hash: h.hash, tables: h.tables.length, rows: h.rows },
    gas: RECORD_GAS,
    waitUntil: 'FINAL',
  });
  const status = out.status as { SuccessValue?: string; Failure?: unknown };
  if (status.Failure !== undefined || status.SuccessValue === undefined) throw new Error(`record() failed: ${JSON.stringify(status.Failure ?? status)}`);
  return { tx_hash: out.transaction.hash, record: JSON.parse(Buffer.from(status.SuccessValue, 'base64').toString('utf8')) as ChainRecord };
}

const today = () => new Date().toISOString().slice(0, 10);

async function anchor(dryRun: boolean): Promise<number> {
  const db = getDb();
  const date = today();
  const existingRecorded = db.prepare("SELECT hash FROM db_anchors WHERE date = ? AND status = 'recorded'").get(date) as { hash: string } | undefined;
  if (existingRecorded && !dryRun) {
    console.log(`[anchor-db] ${date} already recorded on chain (${existingRecorded.hash}); the contract keeps one hash a day`);
    return 0;
  }
  const t0 = Date.now();
  const file = dryRun ? null : snapshot(db, date);
  const copy = file ? new Database(file, { readonly: true, fileMustExist: true }) : null;
  const h = hashDatabase(copy ?? db);
  copy?.close();
  console.log(`[anchor-db] ${date} ${h.hash}: ${h.tables.length} tables, ${h.rows} rows, ${Date.now() - t0} ms${file ? `, snapshot ${file}` : ''}`);
  if (dryRun) return h.rows;

  const cfg = anchorConfig();
  const save = db.prepare(`INSERT INTO db_anchors (date, hash, tables, rows, manifest, computed_at, status, network, contract, account, tx_hash, block_height, error)
    VALUES (@date, @hash, @tables, @rows, @manifest, @computed_at, @status, @network, @contract, @account, @tx_hash, @block_height, @error)
    ON CONFLICT(date) DO UPDATE SET hash = excluded.hash, tables = excluded.tables, rows = excluded.rows, manifest = excluded.manifest,
      computed_at = excluded.computed_at, status = excluded.status, network = excluded.network, contract = excluded.contract,
      account = excluded.account, tx_hash = excluded.tx_hash, block_height = excluded.block_height, error = excluded.error`);
  const row = {
    date, hash: h.hash, tables: h.tables.length, rows: h.rows, manifest: JSON.stringify(h.tables), computed_at: new Date().toISOString(),
    network: cfg?.network ?? null, contract: cfg?.contract ?? null, account: cfg?.account ?? null,
  };
  if (!cfg) {
    save.run({ ...row, status: 'local', tx_hash: null, block_height: null, error: null });
    logRun('anchor-db', { status: 'partial', items: h.rows, error: 'no anchor account configured: hash stored locally, not recorded on NEAR' }, db);
    console.log('[anchor-db] NEARPEDIA_ANCHOR_* not set: stored locally only');
    return h.rows;
  }
  try {
    const onChain = await chainRecord(cfg.rpc, cfg.contract, date);
    if (onChain) {
      // A run that recorded and then died before saving: the chain is the
      // truth, and a different hash for today cannot be written over it.
      if (onChain.hash !== h.hash) throw new Error(`the chain already holds ${onChain.hash} for ${date}; the database changed since, and a date is recorded once`);
      save.run({ ...row, status: 'recorded', tx_hash: null, block_height: onChain.block_height, error: null });
      return h.rows;
    }
    const { tx_hash, record } = await recordOnChain(cfg, date, h);
    save.run({ ...row, status: 'recorded', tx_hash, block_height: record.block_height, error: null });
    console.log(`[anchor-db] recorded on ${cfg.network} in ${tx_hash} at block ${record.block_height}`);
    return h.rows;
  } catch (e) {
    save.run({ ...row, status: 'failed', tx_hash: null, block_height: null, error: publicError(e) });
    throw e;
  }
}

async function verify(file: string, date: string | undefined): Promise<void> {
  const copy = new Database(file, { readonly: true, fileMustExist: true });
  const h = hashDatabase(copy);
  const cfg = anchorConfig();
  const d = date ?? today();
  console.log(`[anchor-db] ${file}: ${h.hash} (${h.tables.length} tables, ${h.rows} rows)`);
  if (!cfg) {
    console.log('[anchor-db] NEARPEDIA_ANCHOR_* not set: nothing on chain to compare with');
    return;
  }
  const r = await chainRecord(cfg.rpc, cfg.contract, d);
  if (!r) throw new Error(`${cfg.contract} on ${cfg.network} has no record for ${d}`);
  if (r.hash !== h.hash) throw new Error(`MISMATCH: ${cfg.contract} recorded ${r.hash} for ${d} at block ${r.block_height}`);
  console.log(`[anchor-db] MATCH: ${cfg.contract} recorded this hash for ${d} at block ${r.block_height}`);
}

if (isEntrypoint(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === '--verify') {
    if (!args[1]) {
      console.error('usage: anchor-db.ts --verify <db-file> [YYYY-MM-DD]');
      process.exit(2);
    }
    verify(args[1], args[2]).catch((e) => {
      console.error(`[anchor-db] ${(e as Error).message}`);
      process.exit(1);
    });
  } else {
    guardSync('anchor-db', () => anchor(args.includes('--dry-run'))).catch((e) => {
      console.error(e);
      process.exit(1);
    });
  }
}
