/**
 * Protocol state of mainnet and testnet from public RPC: the version each
 * network runs and the newest its nodes support, the epoch, the upgrade
 * threshold, the block-producer stakes, and the version each producer
 * announces in the blocks it makes this epoch (the upgrade vote).
 *
 * Votes accumulate across runs: each run reads at most MAX_SAMPLES blocks,
 * spread evenly since the last block it read, so a run stays cheap on a free
 * RPC tier and successive runs reach more producers. Votes and stakes are
 * kept per epoch and retired two epochs back; snapshots are kept for
 * SNAPSHOT_DAYS so an upgrade can be dated.
 *
 *   npx tsx scripts/sync-protocol.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { SITE } from '../lib/site.config';
import { rpcClient, type RpcClient } from '../lib/near-rpc';
import { NETWORKS, type Network } from '../lib/near-sources';
import { sampleFailureNote, sampleHeights } from '../lib/protocol';
import { recordEvents } from '../lib/change-events';

const UA = `${SITE.slug}-sync/1.0 (+${SITE.publisher.url})`;
const MAX_SAMPLES = 60;
const SNAPSHOT_DAYS = 90;
const RETIRED_EPOCHS = 2;

interface Status {
  chain_id: string;
  protocol_version: number;
  latest_protocol_version: number;
  version: { version: string };
  sync_info: { latest_block_height: number; latest_block_time: string };
}
interface ProtocolConfig { protocol_upgrade_stake_threshold?: [number, number]; epoch_length?: number }
interface Block { author: string; header: { height: number; epoch_id: string; latest_protocol_version: number; timestamp_nanosec: string } }
interface Validators {
  epoch_height: number;
  epoch_start_height: number;
  current_validators: Array<{ account_id: string; stake: string; num_expected_blocks: number }>;
}

const nanosToIso = (ns: string) => new Date(Number(BigInt(ns) / BigInt(1_000_000))).toISOString();

async function syncNetwork(network: Network, rpc: RpcClient, now: string): Promise<{ samples: number; failedSamples: number; firstFailure: string | null; upgraded: boolean }> {
  const db = getDb();
  const status = await rpc.call<Status>('status', []);
  // A misconfigured endpoint answering for the other network would write
  // testnet's 88 as mainnet's protocol.
  if (status.chain_id !== network) throw new Error(`${rpc.endpoint()} answers for chain ${status.chain_id}, not ${network}`);
  const prev = db.prepare('SELECT protocol_version FROM protocol_snapshots WHERE network = ? ORDER BY observed_at DESC LIMIT 1').get(network) as { protocol_version: number } | undefined;
  // Versions only rise. A lower one is an endpoint left behind; storing it
  // would flip "in effect" back to "not yet" and then report the upgrade twice.
  if (prev && status.protocol_version < prev.protocol_version) {
    throw new Error(`${rpc.endpoint()} reports protocol ${status.protocol_version}, below the ${prev.protocol_version} already observed; snapshot refused`);
  }
  const cfg = await rpc.call<ProtocolConfig>('EXPERIMENTAL_protocol_config', { finality: 'final' });
  const head = await rpc.call<Block>('block', { finality: 'final' });
  const epochId = head.header.epoch_id;
  // The validator set of the head's own epoch: `[null]` answers for the
  // node's latest block, which near a boundary is already the next epoch.
  const validators = await rpc.call<Validators>('validators', { epoch_id: epochId });
  if (validators.epoch_start_height > head.header.height) throw new Error(`validators answered for an epoch starting at ${validators.epoch_start_height}, after head ${head.header.height}`);
  const epochLength = cfg.epoch_length ?? null;

  db.transaction(() => {
    db.prepare('DELETE FROM validator_stakes WHERE network = ? AND epoch_id = ?').run(network, epochId);
    const ins = db.prepare('INSERT INTO validator_stakes (network, epoch_id, account_id, stake, block_producer) VALUES (?, ?, ?, ?, ?)');
    for (const v of validators.current_validators) ins.run(network, epochId, v.account_id, v.stake, v.num_expected_blocks > 0 ? 1 : 0);
  })();

  const last = (db.prepare('SELECT MAX(block_height) h FROM validator_votes WHERE network = ? AND epoch_id = ?').get(network, epochId) as { h: number | null }).h;
  const heights = sampleHeights(last, head.header.height, validators.epoch_start_height, MAX_SAMPLES);
  const upsert = db.prepare(`INSERT INTO validator_votes (network, epoch_id, account_id, voted_version, block_height, block_time)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(network, epoch_id, account_id) DO UPDATE SET
      voted_version = excluded.voted_version, block_height = excluded.block_height, block_time = excluded.block_time
      WHERE excluded.block_height > validator_votes.block_height`);
  let failedSamples = 0;
  let firstFailure: string | null = null;
  for (const h of heights) {
    try {
      const b = await rpc.call<Block>('block', { block_id: h });
      if (b.header.epoch_id !== epochId) continue;
      upsert.run(network, epochId, b.author, b.header.latest_protocol_version, b.header.height, nanosToIso(b.header.timestamp_nanosec));
    } catch (e) {
      // A height with no block (skipped by its producer) answers UNKNOWN_BLOCK; that is not a failure.
      const message = (e as Error).message;
      if (!/UNKNOWN_BLOCK|DB Not Found/i.test(message)) {
        failedSamples++;
        firstFailure ??= `height ${h}: ${message}`;
      }
    }
  }

  db.prepare(`INSERT INTO protocol_snapshots (network, observed_at, chain_id, protocol_version, latest_protocol_version, node_version, block_height,
      block_time, epoch_id, epoch_height, epoch_start_height, epoch_length, threshold_num, threshold_den, endpoint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    network, now, status.chain_id, status.protocol_version, status.latest_protocol_version, status.version.version,
    status.sync_info.latest_block_height, status.sync_info.latest_block_time, epochId, validators.epoch_height,
    validators.epoch_start_height, epochLength, cfg.protocol_upgrade_stake_threshold?.[0] ?? null, cfg.protocol_upgrade_stake_threshold?.[1] ?? null, rpc.endpoint(),
  );

  const upgraded = Boolean(prev && status.protocol_version > prev.protocol_version);
  if (upgraded) {
    recordEvents(db, [{
      kind: 'protocol_upgraded',
      subject: `protocol:${network}`,
      title: `${network} upgraded from protocol ${prev!.protocol_version} to ${status.protocol_version}`,
      detail: { from: prev!.protocol_version, to: status.protocol_version, block_height: status.sync_info.latest_block_height, epoch_height: validators.epoch_height },
      source_url: rpc.endpoint(),
      key: String(status.protocol_version),
    }], now);
  }

  // Retention by height and age, not by a set of ids: two epochs back is
  // past any vote that can still decide an upgrade.
  if (epochLength) {
    const cutoff = validators.epoch_start_height - RETIRED_EPOCHS * epochLength;
    db.prepare('DELETE FROM validator_votes WHERE network = ? AND block_height < ?').run(network, cutoff);
  }
  db.prepare(`DELETE FROM validator_stakes WHERE network = ? AND epoch_id NOT IN (
      SELECT DISTINCT epoch_id FROM protocol_snapshots WHERE network = ? AND observed_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days'))`).run(network, network);
  db.prepare("DELETE FROM protocol_snapshots WHERE network = ? AND observed_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)").run(network, `-${SNAPSHOT_DAYS} days`);

  return { samples: heights.length, failedSamples, firstFailure, upgraded };
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  const problems: string[] = [];
  let ok = 0;
  for (const network of NETWORKS) {
    try {
      const r = await syncNetwork(network, rpcClient(network, UA), now);
      ok++;
      if (r.failedSamples) problems.push(sampleFailureNote(network, r.failedSamples, r.samples, r.firstFailure));
      console.log(`[sync-protocol] ${network}: ${r.samples} blocks sampled${r.upgraded ? ', PROTOCOL UPGRADED' : ''}`);
    } catch (e) {
      problems.push(`${network}: ${(e as Error).message}`);
    }
  }
  logRun('protocol', {
    status: ok === 0 ? 'error' : problems.length ? 'partial' : 'success',
    items: ok,
    error: problems.length ? problems.join(' ; ').slice(0, 1000) : undefined,
  }, getDb());
  for (const p of problems) console.warn(`  ${p}`);
  if (ok === 0) process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  guardSync('protocol', main).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
