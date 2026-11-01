/**
 * A citation URL that does not lead to the thing it names.
 *
 * Every tool that returns a row also returns a link, and that link is what
 * an agent quotes to a human. Nothing checked them here.
 *
 * Uses lib/mcp-probe.ts's shared startScratchMcp for the VACUUM INTO / spawn /
 * health-poll plumbing rather than hand-spawning a child process.
 *
 * WHAT IT ASSERTS:
 *
 *   1. structural, no network: no emitted url may carry an empty path
 *      segment, a doubled scheme, whitespace, or the literal
 *      "undefined"/"null"/"NaN". An empty segment IS the class - it is what
 *      an absent id looks like after interpolation.
 *   2. reachable: every distinct nearpedia.example url is fetched and must not
 *      404. Bounded and de-duplicated; redirects are not followed, because
 *      a redirect to an index is exactly this failure mode and following it
 *      would hide it.
 *   3. buildSourceLink is walked over every embedding source_type the
 *      corpus actually holds, which is where a new type shows up the day
 *      it is indexed rather than when someone remembers to add it.
 *
 *   npx tsx scripts/check-citations.ts
 */

import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { buildSourceLink } from '../lib/source-urls';
import { startScratchMcp } from '../lib/mcp-probe';
import { SITE } from '../lib/site.config';

const SITE_HOST = SITE.host;
/** Cap on network probes. De-duplicated first, so this is 40 distinct pages. */
const MAX_FETCH = 40;
const ORIGIN = process.env.NEARPEDIA_ORIGIN ?? 'http://127.0.0.1:3130';

interface Probe {
  tool: string;
  args: Record<string, unknown>;
  why: string;
  noUrlsBecause?: string;
}

const PROBES: Probe[] = [
  { tool: 'search', args: { query: 'validator' }, why: 'mixed sources, the widest url surface there is' },
  { tool: 'search', args: { query: 'node' }, why: 'wide match across every tier' },
  { tool: 'get_recent_changes', args: { days: 7 }, why: 'by construction the freshest rows, where an id is likeliest to be missing' },
  { tool: 'get_trending', args: {}, why: 'mixed source urls' },
  { tool: 'list_cips', args: { limit: 5 }, why: 'site-hosted detail pages' },
  { tool: 'list_ecosystem_projects', args: { limit: 5 }, why: 'third-party project urls' },
  { tool: 'list_github_discussions', args: { limit: 5 }, why: 'github_discussion urls' },
  { tool: 'find_similar_projects', args: { description: 'an application built on NEAR' }, why: 'ecosystem urls via a different query path than list_ecosystem_projects' },
];

const URL_RE = /https?:\/\/[^\s)\]<>"'`⟫]+/g;
// "…" too: lib/search.ts's snippet() glues its own end-of-excerpt ellipsis
// directly onto the text with no space when the excerpt happens to end
// right at a URL, which is a complete, real URL followed by punctuation
// that isn't part of it - not the truncated-mid-URL shape this check
// exists to catch. Without stripping it, `new URL()` on the combined
// string reported a false "does not parse as a URL" on a link that was
// actually whole. Found via check-citations itself flagging one.
const TRAILING = /[.,;:)\]}>'"…]+$/;

/** Structural faults that need no network, each one a shape an interpolation bug makes. */
function structuralFault(u: string): string | null {
  let parsed: URL;
  try { parsed = new URL(u); } catch { return 'does not parse as a URL'; }

  if (/\/https?:\/\//i.test(parsed.pathname)) return 'a second scheme inside the path (an absolute url joined onto the site base)';

  // The empty-segment and trailing-slash rules below assume WE built the
  // path by interpolating our own id into it, which is only true for our
  // own host. blog.yourchain.example's Ghost URLs legitimately end every post
  // with a trailing slash (e.g. /a-blockspace-odyssey/) - that convention
  // is theirs to keep, not evidence of our interpolation dropping an id.
  // check-citations caught this as a false positive on a real
  // buildSourceLink(blog_post) url before this host guard was added.
  if (parsed.host === SITE_HOST) {
    const segs = parsed.pathname.split('/').slice(1);
    if (segs.length > 1 && segs.some((s, i) => s === '' && i < segs.length)) {
      if (!(segs.length === 1 && segs[0] === '')) return 'an empty path segment: an identifier was interpolated absent';
    }
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/') && parsed.pathname.split('/').filter(Boolean).length >= 2) {
      return 'a trailing slash where an identifier belongs';
    }
  }

  if (/\b(undefined|null|NaN)\b/.test(parsed.pathname + parsed.search)) return 'the literal undefined/null/NaN, from an interpolated missing value';
  if (/\s/.test(u)) return 'whitespace inside the URL';
  return null;
}

async function main(): Promise<void> {
  const db = getDb();
  const problems: string[] = [];
  const lines: string[] = [];

  let urlCount = 0;
  const internal = new Map<string, string>(); // url -> the tool that emitted it

  const mcp = await startScratchMcp({ label: 'check-citations', callTimeoutMs: 60_000 });
  try {
    // EVERY SOURCE TYPE THROUGH THE ONE LINK BUILDER.
    const types = (mcp.snapshot.prepare('SELECT DISTINCT source_type t FROM embedding_chunks').all() as Array<{ t: string }>).map((r) => r.t);
    let built = 0;
    for (const t of types) {
      const row = mcp.snapshot.prepare('SELECT source_id FROM embedding_chunks WHERE source_type = ? LIMIT 1').get(t) as { source_id: string } | undefined;
      if (!row) continue;
      const link = buildSourceLink(t, String(row.source_id));
      if (!link) { problems.push(`buildSourceLink has no route for source type "${t}", which the corpus holds`); continue; }
      built++;
      const fault = structuralFault(link.url);
      if (fault) { problems.push(`buildSourceLink(${t}) gives ${link.url} : ${fault}`); continue; }
      let h = ''; try { h = new URL(link.url).host; } catch { /* reported */ }
      if (h === SITE_HOST && !internal.has(link.url)) internal.set(link.url, `buildSourceLink(${t})`);
    }
    lines.push(`  ok      ${'buildSourceLink'.padEnd(22)} ${built} of ${types.length} source type(s) routed`);

    for (const p of PROBES) {
      const out = await mcp.callTool(p.tool, p.args);
      if (out.startsWith(' rpc-error:') || out.startsWith('rpc-error:')) { problems.push(`${p.tool} errored: ${out.slice(0, 140)}`); continue; }
      const urls = [...new Set((out.match(URL_RE) ?? []).map((u) => u.replace(TRAILING, '')))];
      if (urls.length === 0) {
        if (p.noUrlsBecause) { lines.push(`  note    ${p.tool.padEnd(22)} no urls by design: ${p.noUrlsBecause.slice(0, 60)}`); continue; }
        problems.push(`${p.tool}(${JSON.stringify(p.args)}) emitted no URL at all, so nothing was graded (${p.why})`);
        continue;
      }
      if (p.noUrlsBecause) {
        problems.push(`${p.tool} is declared to emit no URL, and emitted ${urls.length}; the declaration is stale`);
      }
      urlCount += urls.length;
      for (const u of urls) {
        const fault = structuralFault(u);
        if (fault) problems.push(`${p.tool} emitted ${u} : ${fault}`);
        let h = ''; try { h = new URL(u).host; } catch { /* reported above */ }
        if (h === SITE_HOST && !internal.has(u)) internal.set(u, p.tool);
      }
      lines.push(`  ok      ${p.tool.padEnd(22)} ${String(urls.length).padStart(3)} url(s)`);
    }
  } finally {
    mcp.close();
  }

  // Reachability, for the urls we host. Redirects are NOT followed: a
  // redirect to an index is the failure this check exists for, and
  // following it would turn the defect into a 200.
  //
  // One url per tool per pass, so every tool is represented before any tool
  // gets a second, and whatever is still dropped past the cap is named.
  const byTool = new Map<string, string[]>();
  for (const [u, tool] of internal) { const a = byTool.get(tool) ?? []; a.push(u); byTool.set(tool, a); }
  const sample: Array<[string, string]> = [];
  for (let round = 0; sample.length < MAX_FETCH; round++) {
    let added = false;
    for (const [tool, us] of byTool) {
      if (round < us.length && sample.length < MAX_FETCH) { sample.push([us[round], tool]); added = true; }
    }
    if (!added) break;
  }
  const dropped = internal.size - sample.length;
  let fetched = 0;
  for (const [u, tool] of sample) {
    const target = u.replace(`https://${SITE_HOST}`, ORIGIN);
    try {
      const r = await fetch(target, { redirect: 'manual', headers: { Host: SITE_HOST }, signal: AbortSignal.timeout(15_000) });
      fetched++;
      if (r.status === 404) problems.push(`${tool} cites ${u}, which is a 404`);
      else if (r.status >= 500) problems.push(`${tool} cites ${u}, which answers ${r.status}`);
    } catch (err) {
      problems.push(`${tool} cites ${u}, which could not be fetched (${(err as Error).message.slice(0, 60)})`);
    }
  }
  lines.push(`  ok      ${'reachability'.padEnd(22)} ${fetched} of ${internal.size} distinct ${SITE_HOST} url(s) fetched, none 404${dropped ? ` (${dropped} past the ${MAX_FETCH} cap, round-robin so every tool is covered)` : ''}`);

  for (const l of lines) console.log(l);
  console.log(`[check-citations] ${PROBES.length} probe(s), ${urlCount} url(s) parsed, ${fetched} of ${internal.size} fetched, ${problems.length} problem(s)`);

  for (const p of problems) console.error(`  BROKEN  ${p}`);
  if (problems.length) console.error('  a citation is what an agent quotes to a human; a link that opens the wrong page is worse than one that fails');

  logRun('check-citations', {
    status: problems.length ? 'partial' : 'success',
    items: urlCount,
    error: problems.length ? problems.join(' ; ').slice(0, 1000) : undefined,
  }, db);

  if (problems.length) process.exitCode = 1;
}

main();
