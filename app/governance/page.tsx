import { getDb } from '@/lib/db';
import { pageMetadata } from '@/lib/seo';
import { getLastSync } from '@/lib/section-counts';
import { effectiveStatus, listProposals, type ProposalRow } from '@/lib/hos-read';
import { HOS_PROPOSAL_URL, percent, veNear } from '@/lib/house-of-stake';
import type { Tone } from '@/lib/status';
import { PageShell, PgList, PgRow } from '@/components/page-shell';

export const revalidate = 300;

const LIMIT = 100;

export const metadata = pageMetadata({
  title: 'House of Stake governance',
  description: 'Every House of Stake proposal read from the vote.dao contract: status, the veNEAR vote, quorum and approval, with the gov.near.org thread it came from.',
  path: '/governance',
});

const TONE: Record<string, Tone> = {
  Voting: 'lime',
  Timelock: 'info',
  Created: 'info',
  Approved: 'info',
  Succeeded: 'ok',
  Executable: 'ok',
  InProgress: 'ok',
  Failed: 'bad',
  Vetoed: 'bad',
  Rejected: 'bad',
};

function standing(p: ProposalRow): string {
  if (p.voters_total === 0) return 'No votes cast';
  const decided = (BigInt(p.votes_for) + BigInt(p.votes_against)).toString();
  const quorum = p.quorum_met === null ? '' : p.quorum_met ? ', quorum met' : ', quorum not met';
  return `${percent(p.votes_for, decided)} For · ${veNear(p.votes_total)} veNEAR from ${p.voters_total} voters${quorum}`;
}

function when(p: ProposalRow, now: Date): string {
  const hsp = p.hsp_number !== null ? `HSP-${String(p.hsp_number).padStart(3, '0')} · ` : '';
  const at = p.voting_ends_at?.slice(0, 16).replace('T', ' ');
  const ended = p.voting_ends_at !== null && Date.parse(p.voting_ends_at) < now.getTime();
  const ends = p.status === 'Voting' && at ? `voting ${ended ? 'ended' : 'ends'} ${at} UTC` : `created ${p.created_at.slice(0, 10)}`;
  return `${hsp}#${p.id} · ${ends}`;
}

export default function GovernancePage() {
  let proposals: ProposalRow[] = [];
  try {
    proposals = listProposals(getDb(), { limit: LIMIT });
  } catch {
    proposals = [];
  }
  const now = new Date();

  return (
    <PageShell
      href="/governance"
      title="House of Stake"
      description="NEAR's governance proposals, read from the vote.dao contract: what each one changes, where the veNEAR vote stands and what happens next."
      stat={{ value: proposals.length, unit: proposals.length === 1 ? 'proposal' : 'proposals' }}
      synced={getLastSync('hos_proposals')}
      source="vote.dao · gov.near.org"
    >
      <PgList empty={proposals.length === 0 ? <div className="pg-empty"><p>No proposals synced yet.</p></div> : null}>
        {proposals.map((p, i) => {
          const status = effectiveStatus(p, now);
          return (
            <PgRow
              key={p.id}
              href={p.forum_url ?? HOS_PROPOSAL_URL(p.id)}
              external
              tag={p.status}
              tone={TONE[p.status] ?? 'mute'}
              meta={when(p, now)}
              title={p.title}
              sub={status.lapsed ? `${status.label} · ${standing(p)}` : standing(p)}
              delay={Math.min(i, 16) * 30}
            />
          );
        })}
      </PgList>
      <div className="pg-foot">
        <span>Statuses come from the contract; a vote whose end has passed is finalised on its next contract call.</span>
      </div>
    </PageShell>
  );
}
