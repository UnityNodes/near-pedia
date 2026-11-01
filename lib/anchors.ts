/**
 * Reading db_anchors (scripts/anchor-db.ts) for the REST API and /ask's
 * receipt. An explorer link is given only for a network that has one.
 */

import type Database from 'better-sqlite3';
import type { TableHash } from './db-hash';

export interface AnchorRow {
  date: string;
  hash: string;
  tables: number;
  rows: number;
  computed_at: string;
  status: 'local' | 'recorded' | 'failed';
  network: string | null;
  contract: string | null;
  account: string | null;
  tx_hash: string | null;
  block_height: number | null;
  error: string | null;
}

export interface Anchor extends AnchorRow { explorer_url: string | null }

const EXPLORER: Record<string, string> = { mainnet: 'https://nearblocks.io/txns/', testnet: 'https://testnet.nearblocks.io/txns/' };

const COLS = 'date, hash, tables, rows, computed_at, status, network, contract, account, tx_hash, block_height, error';

function withLink(r: AnchorRow): Anchor {
  const base = r.network ? EXPLORER[r.network] : undefined;
  return { ...r, explorer_url: base && r.tx_hash ? `${base}${r.tx_hash}` : null };
}

export function listAnchors(db: Database.Database, limit: number): Anchor[] {
  return (db.prepare(`SELECT ${COLS} FROM db_anchors ORDER BY date DESC LIMIT ?`).all(limit) as AnchorRow[]).map(withLink);
}

export function getAnchor(db: Database.Database, date: string): (Anchor & { manifest: TableHash[] }) | null {
  const r = db.prepare(`SELECT ${COLS}, manifest FROM db_anchors WHERE date = ?`).get(date) as (AnchorRow & { manifest: string }) | undefined;
  if (!r) return null;
  const { manifest, ...row } = r;
  let parsed: TableHash[] = [];
  try {
    parsed = JSON.parse(manifest) as TableHash[];
  } catch {
    parsed = [];
  }
  return { ...withLink(row), manifest: parsed };
}

/** The most recent hash recorded on chain; /ask names it as the latest daily commitment, not as the state the answer was read from. */
export function latestAnchor(db: Database.Database): Anchor | null {
  try {
    const r = db.prepare(`SELECT ${COLS} FROM db_anchors WHERE status = 'recorded' ORDER BY date DESC LIMIT 1`).get() as AnchorRow | undefined;
    return r ? withLink(r) : null;
  } catch (e) {
    if (/no such table/.test((e as Error).message)) return null;
    throw e;
  }
}
