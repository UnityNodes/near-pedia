import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDb } from '@/lib/db';
import { emptySources, finalize, mergeBySubject, verifyQuote, writeEntries, buildEntries, subjectsOfUrl } from '@/lib/deprecation-engine';
import { docsMarkerCandidates, dormancyEvidence, releaseCandidates, repoCandidates } from '@/lib/deprecation-signals';
import type { Seed } from '@/lib/deprecation-seeds';
import { SEEDS } from '@/lib/deprecation-seeds';

const NOW = new Date('2026-11-01T00:00:00Z');

function repo(full: string, opts: { archived?: number; strength?: 'strong' | 'weak'; notice?: string; replacement?: string; fork?: number } = {}) {
  getDb().prepare(`INSERT INTO github_repos (full_name, org, html_url, fork, archived, readme_notice, readme_marker, readme_strength, readme_replacement, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 't')`).run(full, full.split('/')[0], `https://github.com/${full}`, opts.fork ?? 0, opts.archived ?? 0,
    opts.notice ?? null, opts.notice ?? null, opts.strength ?? null, opts.replacement ?? null);
}

function pkg(registry: 'npm' | 'crates', name: string, repoUrl: string | null, latest = '1.0.0', at = '2026-10-01T00:00:00Z') {
  getDb().prepare(`INSERT INTO packages (id, registry, name, latest_version, latest_published_at, repository_url, registry_url, discovered_by, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'list', 't')`).run(`${registry}:${name}`, registry, name, latest, at, repoUrl, `https://registry/${name}`);
}

function release(repoName: string, tag: string, body: string, at = '2026-10-26T12:00:00Z', prerelease = 0) {
  getDb().prepare(`INSERT INTO github_releases (id, repo, tag, name, body, published_at, url, prerelease, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 't')`)
    .run(`${repoName}@${tag}`, repoName, tag, tag, body, at, `https://github.com/${repoName}/releases/tag/${tag}`, prerelease);
}

function doc(path: string, content: string) {
  getDb().prepare("INSERT INTO doc_pages (url, title, source, content_text) VALUES (?, ?, 'docs', ?)").run(`https://docs.near.org${path}`, path, content);
}

const seed = (over: Partial<Seed>): Seed => ({
  id: 'x', title: 'X', kind: 'package', status: 'deprecated', summary: 'X is deprecated.', replacement: 'Y', replacement_url: null,
  since: null, effective: null, matchers: {}, subjects: [], evidence: [], ...over,
});

describe('signal collectors', () => {
  beforeEach(() => resetDb());

  it('marks an archived repository and the npm package that links to it', () => {
    repo('near/near-sdk-js', { archived: 1, strength: 'strong', notice: 'DEPRECATED DO NOT USE', replacement: 'https://github.com/near/near-sdk-rs' });
    pkg('npm', 'near-sdk-js', 'https://github.com/near/near-sdk-js');
    const [c] = repoCandidates(getDb());
    expect(c).toMatchObject({ kind: 'package', status: 'deprecated', matchers: { npm: ['near-sdk-js'] } });
    expect(c.subjects).toEqual(expect.arrayContaining(['github:near/near-sdk-js', 'npm:near-sdk-js']));
    expect(c.evidence.map((e) => e.signal)).toEqual(['repo_archived', 'readme_notice']);
    expect(c.since).toBeNull();
  });

  it('dates an archive only by an observed live-to-archived change', () => {
    repo('near/x', { archived: 1 });
    getDb().prepare("INSERT INTO change_events (kind, subject, title, observed_at, dedupe_key) VALUES ('repo_archived', 'github:near/x', 't', '2026-10-30T08:00:00Z', 'k')").run();
    expect(repoCandidates(getDb())[0].since).toBe('2026-10-30');
  });

  it('calls a live repository with only a weak README notice possibly deprecated, and ignores forks', () => {
    repo('near/wallet-selector', { strength: 'weak', notice: 'remains supported during the transition period' });
    repo('near/some-fork', { archived: 1, fork: 1 });
    const cs = repoCandidates(getDb());
    expect(cs.map((c) => [c.title, c.status])).toEqual([['near/wallet-selector', 'possibly_deprecated']]);
  });

  it('reads release removals of product tags inside the window only', () => {
    release('near/nearcore', '2.14.0', '# Protocol Changes\n* Removed the `DelegateV2` action.');
    release('near/nearcore', '2.14.0-rc.1', '# Protocol Changes\n* Removed the `Other` action.', '2026-09-01T00:00:00Z', 1);
    release('near/nearcore', '1.30.0', '# Protocol Changes\n* Removed the `Ancient` action.', '2023-01-01T00:00:00Z');
    release('near/near-sdk-rs', 'near-sys-v0.4.0', '### Other\n- remove `sys_thing` from the API');
    release('near/mpc', '3.17.0', '- Drop `Option` from `tee_verifier_account_id`');
    const cs = releaseCandidates(getDb(), NOW);
    expect(cs.map((c) => [c.id, c.kind, c.status, c.since])).toEqual([['nearcore-delegatev2', 'protocol', 'removed', '2026-10-26']]);
    expect(cs[0].matchers).toEqual({ identifiers: ['DelegateV2'] });
  });

  it('reads the RPC reference markers', () => {
    doc('/api-reference/post-broadcast_tx_commit', '/openapi.json post /broadcast_tx_commit\n[Deprecated] Sends a transaction. Consider using send_tx instead.');
    doc('/api-reference/post-block', '/openapi.json post /block\nReturns block details.');
    const cs = docsMarkerCandidates(getDb());
    expect(cs.map((c) => [c.id, c.replacement, c.matchers.rpc])).toEqual([['rpc-broadcast-tx-commit', 'send_tx', ['broadcast_tx_commit']]]);
  });

  it('finds a matched package that has not released for a year', () => {
    pkg('npm', 'old', null, '2.5.1', '2025-01-01T00:00:00Z');
    pkg('npm', 'fresh', null, '7.4.0', '2026-10-23T00:00:00Z');
    expect(dormancyEvidence(getDb(), { npm: ['old', 'fresh'] }, NOW).map((e) => e.quote)).toEqual(['old 2.5.1 is the latest release, published 2025-01-01']);
  });
});

describe('merging and verifying', () => {
  beforeEach(() => resetDb());

  it('lets a seed absorb the signals about its subject and keep its own words', () => {
    repo('near/near-cli', { archived: 1 });
    pkg('npm', 'near-cli', 'https://github.com/near/near-cli');
    const drafts = mergeBySubject([seed({ id: 'near-cli-js', summary: 'Use near-cli-rs.', subjects: ['github:near/near-cli'] })], repoCandidates(getDb()));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ id: 'near-cli-js', origin: 'seed', summary: 'Use near-cli-rs.', matchers: { npm: ['near-cli'] } });
    expect(drafts[0].evidence.map((e) => e.signal)).toEqual(['repo_archived']);
  });

  it('merges two signals about one identifier into one entry', () => {
    release('near/nearcore', '2.12.0', '# Non-protocol Changes\n* Removed deprecated fields from `EpochConfig`: `num_seats`, `other_seats`.', '2026-06-03T00:00:00Z');
    release('near/nearcore', '2.14.0', '# Non-protocol Changes\n* Removed the long-deprecated `num_seats` field.');
    const drafts = mergeBySubject([], releaseCandidates(getDb(), NOW));
    expect(drafts).toHaveLength(1);
    expect(drafts[0].evidence).toHaveLength(2);
  });

  it('verifies a curated docs quote against the synced page, ignoring markdown emphasis and line breaks', () => {
    doc('/a', 'Intro.\n> **NEAR Lake (the AWS S3 source) was deprecated on March 24, 2026** and no longer indexes.');
    const base = { signal: 'docs_statement' as const, strength: 'strong' as const, source_url: 'https://docs.near.org/a', upstream_date: null };
    expect(verifyQuote(getDb(), { ...base, quote: 'NEAR Lake (the AWS S3 source) was deprecated on March 24, 2026' })).toBe(true);
    expect(verifyQuote(getDb(), { ...base, quote: 'NEAR Lake is fine' })).toBe(false);
    expect(verifyQuote(getDb(), { ...base, quote: 'x', checked: '2026-11-01' })).toBeNull();
  });

  it('marks an entry stale when its only curated quote left its source, and does not count it as strong', () => {
    doc('/a', 'The page was rewritten.');
    const s = seed({ evidence: [{ signal: 'docs_statement', strength: 'strong', source_url: 'https://docs.near.org/a', quote: 'X is deprecated', upstream_date: null }] });
    const [e] = finalize(getDb(), mergeBySubject([s], []), NOW);
    expect(e.stale).toBe(true);
    expect(e.evidence[0].verified).toBe(false);
  });

  it('does not let counter-evidence carry an entry', () => {
    const s = seed({ evidence: [{ signal: 'registry_activity', strength: 'medium', source_url: 'u', quote: 'published', upstream_date: null, supports: false, checked: '2026-11-01' }] });
    expect(finalize(getDb(), mergeBySubject([s], []), NOW)[0].stale).toBe(true);
  });
});

describe('writing builds', () => {
  beforeEach(() => resetDb());

  it('replaces the table, and logs entries new since the previous build but not on the first one', () => {
    const db = getDb();
    doc('/api-reference/post-a', '/openapi.json post /a\n[Deprecated] A. Consider using b instead.');
    const first = writeEntries(db, buildEntries(db, NOW), '2026-11-01T00:00:00Z');
    expect(first.added).toBe(0);
    doc('/api-reference/post-c', '/openapi.json post /c\n[Deprecated] C.');
    const second = writeEntries(db, buildEntries(db, NOW), '2026-11-01T06:00:00Z');
    expect(second.added).toBe(1);
    expect((db.prepare("SELECT COUNT(*) n FROM deprecations WHERE id LIKE 'rpc-%'").get() as { n: number }).n).toBe(2);
    const ev = db.prepare("SELECT kind, subject FROM change_events WHERE kind = 'deprecation_added'").all();
    expect(ev).toEqual([{ kind: 'deprecation_added', subject: 'deprecation:rpc-c' }]);
  });
});

describe('the curated seeds', () => {
  it('have unique ids, a summary, and evidence that names a source', () => {
    expect(new Set(SEEDS.map((s) => s.id)).size).toBe(SEEDS.length);
    for (const s of SEEDS) {
      expect(s.summary.length, s.id).toBeGreaterThan(20);
      for (const e of s.evidence) expect(e.source_url, s.id).toMatch(/^https:\/\//);
    }
  });

  it('date by hand every quote the syncs cannot re-check', () => {
    for (const s of SEEDS) {
      for (const e of s.evidence) {
        const recheckable = e.source_url.startsWith('https://docs.near.org/') || /\/releases\/tag\//.test(e.source_url);
        if (!recheckable) expect(e.checked, `${s.id} ${e.source_url}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

describe('review fixes (2026-11-01)', () => {
  beforeEach(() => resetDb());

  it('gives two signals whose names slug alike distinct ids instead of failing the build', () => {
    release('near/nearcore', '2.14.0', '# Protocol Changes\n* Removed the `Foo_Bar` action.\n* Removed the `foo-bar` thing.');
    const db = getDb();
    const entries = buildEntries(db, NOW);
    const ids = entries.filter((e) => e.origin === 'signal').map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => writeEntries(db, entries, 't')).not.toThrow();
  });

  it('never lets a seed absorb its own replacement as a matcher', () => {
    repo('near/near-api-js', { strength: 'weak', notice: 'transition period for the old packages' });
    pkg('npm', 'near-api-js', 'https://github.com/near/near-api-js', '7.4.0');
    pkg('npm', '@near-js/accounts', 'https://github.com/near/near-api-js', '2.5.1', '2025-11-06T00:00:00Z');
    const seeds = [seed({ id: 'near-js-packages', replacement: 'near-api-js 7.x', matchers: { npm: ['@near-js/accounts'] }, subjects: [] })];
    const [d] = mergeBySubject(seeds, repoCandidates(getDb()));
    expect(d.matchers.npm).toEqual(['@near-js/accounts']);
    expect(d.subjects).not.toContain('npm:near-api-js');
  });

  it('takes the more severe status when two signals about one subject merge', () => {
    release('near/nearcore', '2.13.0', '# Non-protocol Changes\n* Deprecated the `old_field` field.', '2026-07-09T00:00:00Z');
    release('near/nearcore', '2.14.0', '# Non-protocol Changes\n* Removed the `old_field` field.');
    const [d] = mergeBySubject([], releaseCandidates(getDb(), NOW));
    expect(d.status).toBe('removed');
  });

  it('marks an entry contested and lowers its strength when counter-evidence is as strong', () => {
    const s = seed({ status: 'possibly_deprecated', evidence: [
      { signal: 'readme_notice', strength: 'medium', source_url: 'u1', quote: 'deprecated', upstream_date: null, checked: '2026-10-30' },
      { signal: 'registry_activity', strength: 'medium', source_url: 'u2', quote: 'published', upstream_date: null, supports: false, checked: '2026-10-30' },
    ] });
    const [e] = finalize(getDb(), mergeBySubject([s], []), NOW);
    expect(e).toMatchObject({ contested: true, strength: 'weak', stale: false });
  });

  it('adds counter-evidence for a matched package that released in the last 90 days', () => {
    repo('near/x', { archived: 1 });
    pkg('npm', 'x', 'https://github.com/near/x', '3.0.0', '2026-10-20T00:00:00Z');
    const [e] = finalize(getDb(), mergeBySubject([], repoCandidates(getDb())), NOW);
    expect(e.evidence.find((v) => !v.supports)?.quote).toBe('x 3.0.0 published 2026-10-20');
    expect(e.contested).toBe(false);
  });

  it('does not let dormancy alone keep a seed alive', () => {
    pkg('npm', 'old', null, '1.0.0', '2024-01-01T00:00:00Z');
    const [e] = finalize(getDb(), mergeBySubject([seed({ matchers: { npm: ['old'] } })], []), NOW);
    expect(e.stale).toBe(true);
    expect(e.evidence).toEqual([]);
  });

  it('stops counting a hand check older than 120 days', () => {
    const s = seed({ evidence: [{ signal: 'governance', strength: 'strong', source_url: 'u', quote: 'q', upstream_date: null, checked: '2026-05-01' }] });
    const [e] = finalize(getDb(), mergeBySubject([s], []), NOW);
    expect(e.evidence[0].expired).toBe(true);
    expect(e.stale).toBe(true);
  });

  it('reads "not synced yet" as unknown, not as a removed quote', () => {
    const base = { signal: 'docs_statement' as const, strength: 'strong' as const, source_url: 'https://docs.near.org/a', quote: 'q', upstream_date: null };
    expect(verifyQuote(getDb(), base)).toBeNull();
    doc('/other', 'x');
    expect(verifyQuote(getDb(), base)).toBe(false);
  });

  it('names the empty source tables a build must not run over', () => {
    expect(emptySources(getDb())).toEqual(['github_repos', 'packages', 'github_releases', 'doc_pages']);
  });
});

describe('replacements that are themselves dead', () => {
  beforeEach(() => resetDb());

  const byId = (id: string) => buildEntries(getDb(), NOW).find((e) => e.id === id)!;

  it('drops a replacement whose chain ends at an archived repository, and says why', () => {
    repo('near/indexer-wallet', { archived: 1, strength: 'strong', notice: 'DEPRECATED. Use the explorer indexer', replacement: 'Explorer indexer (https://github.com/near/indexer-explorer)' });
    repo('near/indexer-explorer', { archived: 1 });
    const e = byId('repo-near-indexer-wallet');
    expect(e.replacement).toBeNull();
    expect(e.replacement_url).toBeNull();
    expect(e.summary).toContain("The README's suggested replacement Explorer indexer (https://github.com/near/indexer-explorer) is itself archived (see check_deprecation(\"repo-near-indexer-explorer\")).");
  });

  it('follows a chain to the first live recommendation', () => {
    repo('near/a', { archived: 1, strength: 'strong', notice: 'deprecated', replacement: 'https://github.com/near/b' });
    repo('near/b', { archived: 1, strength: 'strong', notice: 'deprecated', replacement: 'https://github.com/near/c' });
    repo('near/c');
    const e = byId('repo-near-a');
    expect(e).toMatchObject({ replacement: 'https://github.com/near/c', replacement_url: 'https://github.com/near/c' });
    expect(e.summary).toContain('is itself archived (see check_deprecation("repo-near-b")). Its own recommendation is used instead.');
  });

  it('maps any near.social host to the BOS record and takes its recommendation', () => {
    repo('near/bounties', { archived: 1, strength: 'strong', notice: 'deprecated', replacement: 'Gigs Board (https://devgovgigs.near.social)' });
    doc('/primitives/social', 'While the BOS framework (components/widgets) is deprecated, the social graph stored in SocialDB is still live and maintained.');
    const e = byId('repo-near-bounties');
    expect(e.replacement_url).toBe('https://docs.near.org/primitives/social');
    expect(e.summary).toContain('is itself deprecated (see check_deprecation("bos-components"))');
  });

  it('leaves a live replacement alone and notes one that is gone from a synced org', () => {
    repo('near/old', { archived: 1, strength: 'strong', notice: 'deprecated', replacement: 'https://github.com/near/new' });
    repo('near/new');
    repo('near/tools', { archived: 1, strength: 'strong', notice: 'deprecated', replacement: 'https://github.com/near/workspaces' });
    expect(byId('repo-near-old')).toMatchObject({ replacement_url: 'https://github.com/near/new', summary: expect.not.stringContaining('itself') });
    const t = byId('repo-near-tools');
    expect(t.replacement_url).toBe('https://github.com/near/workspaces');
    expect(t.summary).toContain('https://github.com/near/workspaces is not among the near repositories on GitHub any more');
  });

  it('stops on a cycle instead of looping', () => {
    repo('near/x1', { archived: 1, strength: 'strong', notice: 'deprecated', replacement: 'https://github.com/near/x2' });
    repo('near/x2', { archived: 1, strength: 'strong', notice: 'deprecated', replacement: 'https://github.com/near/x1' });
    expect(byId('repo-near-x1')).toMatchObject({ replacement: null, replacement_url: null });
  });

  it('reads only repository roots, package pages and hosts as subjects', () => {
    expect(subjectsOfUrl('https://github.com/near/near-api-js/blob/master/MIGRATION.md')).toEqual(['host:github.com']);
    expect(subjectsOfUrl('https://www.github.com/Near/Repo.git/')).toEqual(['github:near/repo', 'host:github.com']);
    expect(subjectsOfUrl('https://www.npmjs.com/package/@near-js/accounts')).toEqual(['npm:@near-js/accounts', 'host:npmjs.com']);
    expect(subjectsOfUrl('https://devgovgigs.near.social')).toEqual(['host:devgovgigs.near.social', 'host:near.social']);
    expect(subjectsOfUrl('not a url')).toEqual([]);
  });
});
