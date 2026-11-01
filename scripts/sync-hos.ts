/**
 * House of Stake from its mainnet contracts: every proposal on vote.dao with
 * its votes and the outcome math, veNEAR totals from venear.dao, and the
 * gov.near.org thread each proposal is discussed in (run after sync-forum).
 * A new proposal and a status change go to change_events.
 *
 *   npx tsx scripts/sync-hos.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../lib/db';
import { guardSync, logRun } from '../lib/sync-log';
import { isEntrypoint } from '../lib/is-entrypoint';
import { SITE } from '../lib/site.config';
import { rpcClient } from '../lib/near-rpc';
import { HOS_PROPOSAL_URL, VENEAR_CONTRACT, VOTE_CONTRACT, fromRaw, matchForumTopic, type Proposal, type RawProposal } from '../lib/house-of-stake';
import { recordEvents, type ChangeEvent } from '../lib/change-events';

const UA = `${SITE.slug}-sync/1.0 (+${SITE.publisher.url})`;
const PAGE = 50;
const ACTIVE = new Set(['Created', 'Sandbox', 'Scheduled', 'Queued', 'Voting', 'Timelock', 'Executable', 'InProgress']);

const rpc = rpcClient('mainnet', UA);

async function view<T>(contract: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await rpc.call<{ result: number[] }>('query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  return JSON.parse(Buffer.from(r.result).toString('utf8')) as T;
}

async function main(): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const count = await view<number>(VOTE_CONTRACT, 'get_num_proposals');
  const raws: RawProposal[] = [];
  for (let from = 0; from < count; from += PAGE) raws.push(...await view<RawProposal[]>(VOTE_CONTRACT, 'get_proposals', { from_index: from, limit: PAGE }));
  if (raws.length !== count) throw new Error(`vote.dao reports ${count} proposals but returned ${raws.length}`);
  const [venearTotal, venearAccounts] = await Promise.all([
    view<string>(VENEAR_CONTRACT, 'ft_total_supply'),
    view<number>(VENEAR_CONTRACT, 'get_num_accounts'),
  ]);

  const topics = db.prepare('SELECT id, title, url FROM forum_topics').all() as Array<{ id: number; title: string; url: string }>;
  const before = new Map((db.prepare('SELECT id, status, status_since FROM hos_proposals').all() as Array<{ id: number; status: string; status_since: string | null }>).map((r) => [r.id, r]));
  const firstRun = before.size === 0;
  const events: ChangeEvent[] = [];
  const upsert = db.prepare(`INSERT INTO hos_proposals (id, title, status, status_since, flow, proposer_id, reviewer_id, created_at, approved_at, voting_starts_at,
      voting_ends_at, timelock_ends_at, expires_at, snapshot_block_height, total_venear, votes_for, votes_against, votes_abstain, voters_for, voters_against,
      voters_abstain, votes_total, voters_total, quorum_threshold_bps, quorum_floor, quorum_required, approval_threshold_bps, quorum_met, approval_met,
      has_actions, link, description, hsp_number, forum_topic_id, forum_url, forum_match, synced_at)
      VALUES (@id, @title, @status, @status_since, @flow, @proposer_id, @reviewer_id, @created_at, @approved_at, @voting_starts_at, @voting_ends_at,
      @timelock_ends_at, @expires_at, @snapshot_block_height, @total_venear, @votes_for, @votes_against, @votes_abstain, @voters_for, @voters_against,
      @voters_abstain, @votes_total, @voters_total, @quorum_threshold_bps, @quorum_floor, @quorum_required, @approval_threshold_bps, @quorum_met,
      @approval_met, @has_actions, @link, @description, @hsp_number, @forum_topic_id, @forum_url, @forum_match, @synced_at)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, status = excluded.status, status_since = excluded.status_since, flow = excluded.flow,
      reviewer_id = excluded.reviewer_id, approved_at = excluded.approved_at, voting_starts_at = excluded.voting_starts_at, voting_ends_at = excluded.voting_ends_at,
      timelock_ends_at = excluded.timelock_ends_at, expires_at = excluded.expires_at, snapshot_block_height = excluded.snapshot_block_height,
      total_venear = excluded.total_venear, votes_for = excluded.votes_for, votes_against = excluded.votes_against, votes_abstain = excluded.votes_abstain,
      voters_for = excluded.voters_for, voters_against = excluded.voters_against, voters_abstain = excluded.voters_abstain, votes_total = excluded.votes_total,
      voters_total = excluded.voters_total, quorum_threshold_bps = excluded.quorum_threshold_bps, quorum_floor = excluded.quorum_floor,
      quorum_required = excluded.quorum_required, approval_threshold_bps = excluded.approval_threshold_bps, quorum_met = excluded.quorum_met,
      approval_met = excluded.approval_met, has_actions = excluded.has_actions, link = excluded.link, description = excluded.description,
      hsp_number = excluded.hsp_number, forum_topic_id = excluded.forum_topic_id, forum_url = excluded.forum_url, forum_match = excluded.forum_match,
      synced_at = excluded.synced_at`);

  let linked = 0;
  db.transaction(() => {
    for (const raw of raws) {
      const p: Proposal = fromRaw(raw);
      const prev = before.get(p.id);
      const match = matchForumTopic(p, topics);
      if (match) linked++;
      // A status we saw change is dated by our sync; one we never saw change is not dated at all.
      const statusSince = prev ? (prev.status === p.status ? prev.status_since : now) : null;
      upsert.run({
        ...p,
        status_since: statusSince,
        quorum_met: p.quorum_met === null ? null : p.quorum_met ? 1 : 0,
        approval_met: p.approval_met === null ? null : p.approval_met ? 1 : 0,
        has_actions: p.has_actions ? 1 : 0,
        hsp_number: match?.hsp ?? null,
        forum_topic_id: match?.topic.id ?? null,
        forum_url: match?.topic.url ?? null,
        forum_match: match?.by ?? null,
        synced_at: now,
      });
      const subject = `hos:proposal:${p.id}`;
      if (!prev && !firstRun) {
        events.push({ kind: 'proposal_created', subject, title: `House of Stake proposal ${p.id}: ${p.title}`, detail: { status: p.status, proposer: p.proposer_id }, source_url: HOS_PROPOSAL_URL(p.id), key: String(p.id) });
      } else if (prev && prev.status !== p.status) {
        events.push({ kind: 'proposal_status_changed', subject, title: `House of Stake proposal ${p.id} ${prev.status} → ${p.status}: ${p.title}`, detail: { from: prev.status, to: p.status }, source_url: HOS_PROPOSAL_URL(p.id), key: `${prev.status}->${p.status}` });
      }
    }
    db.prepare('INSERT OR REPLACE INTO hos_stats (observed_at, venear_total, venear_accounts, proposals, active_proposals) VALUES (?, ?, ?, ?, ?)')
      .run(now, venearTotal, venearAccounts, raws.length, raws.filter((r) => ACTIVE.has(r.status)).length);
    db.prepare("DELETE FROM hos_stats WHERE observed_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')").run();
    recordEvents(db, events, now);
  })();

  logRun('hos', { status: 'success', items: raws.length }, db);
  console.log(`[sync-hos] ${raws.length} proposals (${linked} linked to a forum thread), ${venearAccounts} veNEAR accounts, ${events.length} change events`);
}

if (isEntrypoint(import.meta.url)) {
  guardSync('hos', main).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
