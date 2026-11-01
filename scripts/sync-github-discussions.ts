/**
 * Sync GitHub Discussions (developer Q&A) for the core NEAR repos into the
 * github_discussions table via the GraphQL API. Needs GITHUB_TOKEN.
 */
import { config } from 'dotenv';
import { guardSync, logRun } from '../lib/sync-log';
import { prune } from '../lib/prune';
config({ path: '.env.local' });
import { getDb } from '../lib/db';
import { isoNowSql } from '../lib/formats';
import { isEntrypoint } from '../lib/is-entrypoint';

// Exported so check-completeness.ts asks GitHub about the exact same repo
// list this sync reads, rather than a second, hand-typed copy that can drift
// from it.
export const REPOS: [owner: string, name: string][] = [
  ['your-org', 'yourchain-node'],
  ['your-org', 'yourchain-app'],
  ['your-org', 'yourchain-core'],
  ['your-org', 'CIPs'],
];

const TOKEN = process.env.GITHUB_TOKEN;

const QUERY = `query($owner:String!,$name:String!,$cursor:String){
  repository(owner:$owner,name:$name){
    discussions(first:50, after:$cursor, orderBy:{field:CREATED_AT,direction:DESC}){
      pageInfo{ hasNextPage endCursor }
      nodes{
        id databaseId number title body url createdAt updatedAt upvoteCount
        category{ name } author{ login } answer{ id }
        comments(first:20){ nodes{ body author{ login } createdAt } }
      }
    }
  }
}`;

interface DiscussionComment { body: string; author?: { login: string } | null; createdAt: string; upvoteCount?: number }
interface DiscussionNode {
  id: string; databaseId: number; number: number; title: string; body?: string | null; url: string;
  createdAt: string; updatedAt: string; upvoteCount?: number;
  category?: { name: string } | null; author?: { login: string } | null; answer?: { id: string } | null;
  comments?: { nodes?: DiscussionComment[] };
}
interface DiscussionPage { pageInfo?: { hasNextPage: boolean; endCursor: string | null }; nodes: DiscussionNode[] }

async function gql(owner: string, name: string, cursor: string | null): Promise<DiscussionPage | undefined> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'nearpedia-sync' },
    body: JSON.stringify({ query: QUERY, variables: { owner, name, cursor } }),
  });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
  return j.data?.repository?.discussions;
}

async function main() {
  if (!TOKEN) { console.error('GITHUB_TOKEN missing'); process.exit(1); }
  const db = getDb();
  const ins = db.prepare(`INSERT OR REPLACE INTO github_discussions
    (id,repo,db_id,number,title,body,category,author,created_at,updated_at,url,upvotes,comments_count,comments_json,answered,synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,${isoNowSql()})`);

  let total = 0;
  const problems: string[] = [];
  for (const [owner, name] of REPOS) {
    let cursor: string | null = null;
    let repoN = 0;
    // Set only when the pager reached upstream's last page, so a repo with
    // discussions disabled, a null payload or the 20-page cap is never pruned.
    let complete = false;
    const liveIds: string[] = [];
    for (let p = 0; p < 20; p++) {
      let d: DiscussionPage | undefined;
      try { d = await gql(owner, name, cursor); }
      catch (e) {
        if (/Could not resolve to a Repository|discussions are not enabled|discussions/i.test((e as Error).message)) {
          console.warn(`${owner}/${name}: discussions not enabled, skipping`);
          break;
        }
        // Anything else (rate limit, auth, network, GraphQL error) used to be
        // swallowed here: warn, break the pager for this repo, keep going,
        // and the whole run still reported success with an undercount nobody
        // could tell apart from "this repo just has fewer discussions today".
        // check-upstream-echo.ts compares this run's reported total against
        // github_discussions' row count precisely to catch that gap, and it
        // only works if a real fetch failure actually fails the run.
        throw new Error(`[sync-github-discussions] ${owner}/${name}: ${(e as Error).message}`);
      }
      if (!d) break;
      for (const n of d.nodes) {
        const comments = (n.comments?.nodes ?? []).map((c) => ({
          author: c.author?.login,
          body: c.body,
          created_at: c.createdAt,
          upvotes: c.upvoteCount ?? 0,
        }));
        ins.run(n.id, `${owner}/${name}`, n.databaseId, n.number, n.title, n.body ?? '',
          n.category?.name ?? null, n.author?.login ?? null, n.createdAt, n.updatedAt, n.url,
          n.upvoteCount ?? 0, comments.length, JSON.stringify(comments), n.answer ? 1 : 0);
        liveIds.push(n.id);
        repoN++; total++;
      }
      if (!d.pageInfo?.hasNextPage) { complete = true; break; }
      cursor = d.pageInfo.endCursor;
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`${owner}/${name}: ${repoN} discussions`);
    // This only ever inserted, so a discussion deleted upstream stayed served.
    // The pager above exhausted hasNextPage, so what came back is the whole set
    // for this repo and anything else held under it is gone. Scoped per repo.
    if (complete) {
      const pruned = prune({
        table: 'github_discussions',
        keyColumn: 'id',
        scopeColumn: 'repo',
        scopeValue: `${owner}/${name}`,
        liveKeys: liveIds,
      }, db);
      if (pruned.refused) {
        problems.push(`${owner}/${name}: prune refused, ${pruned.reason}`);
        console.warn(`  prune REFUSED: ${pruned.reason}`);
      } else if (pruned.deleted) {
        console.log(`  pruned ${pruned.deleted} discussion(s) upstream no longer has`);
      }
    }
  }
  const c = (db.prepare('SELECT COUNT(*) c FROM github_discussions').get() as { c: number }).c;
  console.log(`DONE — github_discussions total ${c} (wrote ${total})`);
  if (problems.length) logRun('github-discussions', { status: 'partial', items: total, error: problems.join(' ; ').slice(0, 1000) }, db);
  return total;
}
// isEntrypoint, not a bare call: check-completeness.ts imports REPOS above -
// a bare guardSync() ran this sync for real against prod the moment that
// import was added, discovered live while building that check.
if (isEntrypoint(import.meta.url)) {
  guardSync('github-discussions', main).catch((e) => { console.error(e); process.exit(1); });
}
