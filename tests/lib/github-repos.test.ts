import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectReadmeNotice, diffRepo, fromGithubRepo, homepageUrl, readmeNoticeEvent } from '@/lib/github-repos';

const read = (name: string) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'near', name), 'utf8');

describe('fromGithubRepo on the near org listing (2026-11-01)', () => {
  const repos = (JSON.parse(read('gh-org-repos-near.json')) as unknown[]).map((r) => fromGithubRepo(r as never));

  it('reads near-sdk-js as archived and nearcore as live', () => {
    expect(repos.find((r) => r.full_name === 'near/near-sdk-js')?.archived).toBe(true);
    expect(repos.find((r) => r.full_name === 'near/nearcore')?.archived).toBe(false);
  });

  it('takes the org from the full name', () => {
    expect(repos.every((r) => r.org === 'near')).toBe(true);
  });
});

describe('detectReadmeNotice on real READMEs', () => {
  it('near-sdk-js: strong, pointing at near-sdk-rs', () => {
    const n = detectReadmeNotice(read('readme-near-sdk-js.md'));
    expect(n?.strength).toBe('strong');
    expect(n?.notice).toMatch(/DEPRECATED/);
    expect(n?.replacement).toBe('https://github.com/near/near-sdk-rs');
  });

  it('near-cli: strong, pointing at near-cli-rs', () => {
    const n = detectReadmeNotice(read('readme-near-cli.md'));
    expect(n?.strength).toBe('strong');
    expect(n?.replacement).toBe('near-cli-rs (https://github.com/near/near-cli-rs)');
  });

  it('wallet-selector: weak (still supported in a transition period), pointing at HOT Connect', () => {
    const n = detectReadmeNotice(read('readme-wallet-selector.md'));
    expect(n?.strength).toBe('weak');
    expect(n?.replacement).toBe('HOT Connect (https://github.com/azbang/hot-connector)');
  });
});

describe('detectReadmeNotice on opening lines seen in NEAR READMEs (2026-11-01)', () => {
  it.each([
    ['near/bounties', 'UPDATE: This repo is deprecated, please use [Gigs Board](https://devgovgigs.near.social) to submit your ideas.'],
    ['near/ai-platform', 'This is a deprecated prototype. It demonstrates storing a directory of interrelated resources on BOS.'],
    ['nearai/nearai', '# ⚠️ DEPRECATED - NEAR AI Agent Framework\n\n> [!WARNING]\n> This project is deprecated.'],
    ['near/near-indexer-base', '# Indexer Base [DEPRECATED]\n\nConsider using [Microindexers](https://github.com/near/near-microindexers) instead.'],
    ['near/near-sdk-tools', 'Deprecation warning: This project is not maintained. Use https://github.com/near/workspaces instead.'],
    ['near/nearcore-support', '# nearcore-support [deprecated]\n\nThis project is archived.'],
  ])('%s is a strong notice', (_repo, text) => {
    expect(detectReadmeNotice(text)?.strength).toBe('strong');
  });

  it('aurora-relayer points at the repository it says to visit', () => {
    expect(detectReadmeNotice('⚠ WARNING: This repository is deprecated. Please visit [Aurora Relayer V2](https://github.com/aurora-is-near/relayer2-public) instead.')?.replacement)
      .toBe('Aurora Relayer V2 (https://github.com/aurora-is-near/relayer2-public)');
  });

  it('near/near-indexer-base points at Microindexers', () => {
    expect(detectReadmeNotice('# Indexer Base [DEPRECATED]\n\nConsider using [Microindexers](https://github.com/near/near-microindexers) instead.')?.replacement)
      .toBe('Microindexers (https://github.com/near/near-microindexers)');
  });

  it.each([
    ['near/NEPs, a table row about one standard', '# NEPs\n\n| NEP | Title |\n|---|---|\n| [0021](https://github.com/near/NEPs/blob/master/neps/nep-0021.md) | Fungible Token Standard (Deprecated) | @evgenykuzyakov |'],
    ['near/awesome-near, a list item', '# Awesome NEAR\n\n- [Shade Agent](shade-agent) (deprecated)\n- [IronClaw](ironclaw)'],
    ['near/alertexer, a component in a list', '# Alertexer\n\n- deprecated [`tx-alertexer`](./tx-alertexer) (excluded from the workspace)'],
    ['near/openweb-jobs, an instruction about issues', '# Jobs\n\nDO NOT USE THIS REPOSITORY ISSUES DIRECTLY, for fully-featured access to open positions sign in.'],
    ['nearai/ironclaw-desktop-app, a testing tip', '# Desktop\n\nDo not use a bare browser tab as proof that auth works.'],
    ['near/borsh-construct-py, an install step', '# borsh\n\nInstall nox-poetry (note: do not use Poetry to install this, see its docs).'],
    ['near/create-near-app, deprecated flags', '# Create NEAR App\n\nContract language arguments (`--contract rs`, `--contract ts`), `none` values, and the legacy `next-page` frontend are deprecated.'],
    ['a shell comment inside a fenced block', '# create-near-app\n\n```bash\n# deprecated, use npx create-near-app\nnpx create-near-app@latest\n```'],
    ['a deprecated API named in a sentence', '# near-api-js\n\nThe old wallet API is deprecated, see the migration guide.'],
    ['a later section heading about deprecated flags', '# near-cli-rs\n\nCommand line tool.\n\n## Deprecated flags\n\n`--old` is gone.'],
  ])('%s is not a notice about the repository', (_what, text) => {
    expect(detectReadmeNotice(text)).toBeNull();
  });
});

describe('detectReadmeNotice false positives', () => {
  it('ignores a deprecated API mentioned far down a live README', () => {
    const filler = Array.from({ length: 40 }, (_, i) => `Line ${i} of the guide.`).join('\n');
    expect(detectReadmeNotice(`# near-sdk-rs\n\nRust SDK.\n\n${filler}\n\n\`env::foo()\` is deprecated, use \`env::bar()\`.\n`)).toBeNull();
  });

  it('ignores badges and finds nothing in a plain README', () => {
    expect(detectReadmeNotice('[![CI](https://x/badge.svg)](https://x)\n# nearcore\n\nReference client for NEAR Protocol.\n')).toBeNull();
  });
});

describe('homepageUrl', () => {
  it.each([
    ['near-by-example-rust.vercel.app', 'https://near-by-example-rust.vercel.app'],
    ['https://near.org', 'https://near.org'],
    ['https://docs.near.org/tools/', 'https://docs.near.org/tools/'],
    ['javascript:alert(1)', null],
    ['not a url', null],
    ['', null],
  ])('%s -> %s', (raw, expected) => {
    expect(homepageUrl(raw)).toBe(expected);
  });
});

describe('diffRepo and readmeNoticeEvent', () => {
  const snap = (archived: boolean) => fromGithubRepo({ full_name: 'near/x', html_url: 'https://github.com/near/x', archived, pushed_at: '2026-10-30T00:00:00Z' });

  it('reports an archive only when the repository was seen live before', () => {
    expect(diffRepo(undefined, snap(true))).toEqual([]);
    expect(diffRepo({ full_name: 'near/x', archived: 1, readme_marker: null }, snap(true))).toEqual([]);
    const [e] = diffRepo({ full_name: 'near/x', archived: 0, readme_marker: null }, snap(true));
    expect(e.kind).toBe('repo_archived');
    expect(e.subject).toBe('github:near/x');
  });

  it('reports a README notice only when an earlier check saw it without one', () => {
    const notice = detectReadmeNotice('# DEPRECATED\n');
    expect(readmeNoticeEvent('near/x', 'u', false, null, notice)).toEqual([]);
    expect(readmeNoticeEvent('near/x', 'u', true, notice!.marker, notice)).toEqual([]);
    expect(readmeNoticeEvent('near/x', 'u', true, null, notice)[0].kind).toBe('repo_readme_notice');
  });

  it('keys the notice on its marker line, so editing the lines after it is not a new notice', () => {
    const a = detectReadmeNotice('# DEPRECATED\n\nUse near-sdk-rs.\n')!;
    const b = detectReadmeNotice('# DEPRECATED\n\nUse near-sdk-rs 5.x, see the guide.\n')!;
    expect(a.notice).not.toBe(b.notice);
    expect(a.marker).toBe(b.marker);
    expect(readmeNoticeEvent('near/x', 'u', true, a.marker, b)).toEqual([]);
  });
});
