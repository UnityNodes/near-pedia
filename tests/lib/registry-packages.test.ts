import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffPackage, fromCrates, fromNpm, normalizeRepoUrl, type PackageSnapshot } from '@/lib/registry-packages';

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'near', name), 'utf8'));

describe('normalizeRepoUrl', () => {
  it.each([
    ['git+https://github.com/near/near-api-js.git', 'https://github.com/near/near-api-js'],
    ['git+ssh://git@github.com/near/workspaces-js.git', 'https://github.com/near/workspaces-js'],
    ['https://github.com/near/near-sdk-rs', 'https://github.com/near/near-sdk-rs'],
    ['https://github.com/near/nearcore/tree/master/core/primitives', 'https://github.com/near/nearcore'],
    ['github:near/near-cli', 'https://github.com/near/near-cli'],
    ['near/near-cli', 'https://github.com/near/near-cli'],
  ])('%s', (raw, expected) => {
    expect(normalizeRepoUrl(raw)).toBe(expected);
  });

  it('reads the url of a repository object and keeps a non-GitHub host as given', () => {
    expect(normalizeRepoUrl({ type: 'git', url: 'git+https://github.com/near/wallet-selector.git' })).toBe('https://github.com/near/wallet-selector');
    expect(normalizeRepoUrl('https://gitlab.com/x/y')).toBe('https://gitlab.com/x/y');
    expect(normalizeRepoUrl(undefined)).toBeNull();
    expect(normalizeRepoUrl('  ')).toBeNull();
  });
});

describe('fromNpm on real registry documents (2026-11-01)', () => {
  it('reads near-api-js: latest 7.4.0, its date, the repo, no deprecation', () => {
    const p = fromNpm(fixture('npm-near-api-js.json'));
    expect(p.id).toBe('npm:near-api-js');
    expect(p.latest_version).toBe('7.4.0');
    expect(p.latest_published_at).toBe('2026-10-23T22:06:11.442Z');
    expect(p.latest_stable_version).toBe('7.4.0');
    expect(p.deprecated).toBeNull();
    expect(p.repository_url).toBe('https://github.com/near/near-api-js');
    expect(p.registry_url).toBe('https://www.npmjs.com/package/near-api-js');
    expect(p.versions.length).toBeGreaterThan(5);
  });

  it('reads near-sdk-js as live on npm although its repository is archived', () => {
    const p = fromNpm(fixture('npm-near-sdk-js.json'));
    expect(p.latest_version).toBe('2.0.0');
    expect(p.deprecated).toBeNull();
    expect(p.repository_url).toBe('https://github.com/near/near-sdk-js');
  });

  it('falls back to the latest version for the repository when the package has none at the top', () => {
    const doc = fixture('npm-near-js-accounts.json');
    expect(doc.repository).toBeUndefined();
    const p = fromNpm(doc);
    expect(p.latest_version).toBe('2.5.1');
  });

  it('survives a description or homepage that is not a string', () => {
    const doc = fixture('npm-near-sdk-js.json');
    doc.description = { en: 'x' };
    doc.homepage = 42;
    const p = fromNpm(doc);
    expect(p.description).toBeNull();
    expect(p.homepage).toBeNull();
  });

  it('takes the deprecation message of the latest version as the package flag', () => {
    const doc = fixture('npm-near-sdk-js.json');
    doc.versions['2.0.0'].deprecated = 'Use near-sdk-rs';
    const p = fromNpm(doc);
    expect(p.deprecated).toBe('Use near-sdk-rs');
    expect(p.versions.find((v) => v.version === '2.0.0')?.deprecated).toBe('Use near-sdk-rs');
  });
});

describe('fromCrates on real crates.io documents (2026-11-01)', () => {
  it('reads near-sdk 5.30.0 with its publish date', () => {
    const p = fromCrates(fixture('crate-near-sdk.json'));
    expect(p.id).toBe('crates:near-sdk');
    expect(p.latest_version).toBe('5.30.0');
    expect(p.latest_published_at).toMatch(/^2026-10-27/);
    expect(p.repository_url).toBe('https://github.com/near/near-sdk-rs');
    expect(p.deprecated).toBeNull();
  });

  it('keeps a yanked version as yanked', () => {
    const p = fromCrates(fixture('crate-near-jsonrpc-client.json'));
    expect(p.versions.find((v) => v.version === '0.10.2')?.yanked).toBe(true);
    expect(p.versions.find((v) => v.version === '0.23.0')?.yanked).toBe(false);
  });

  it('separates the newest pre-release from the newest stable version', () => {
    const p = fromCrates(fixture('crate-cargo-near.json'));
    expect(p.latest_version).toBe('0.23.0-rc.2');
    expect(p.latest_stable_version).toBe('0.22.0');
  });

  it('calls a crate whose every version is yanked deprecated', () => {
    const doc = fixture('crate-near-jsonrpc-client.json');
    for (const v of doc.versions) v.yanked = true;
    expect(fromCrates(doc).deprecated).toBe('every published version is yanked');
  });
});

describe('diffPackage', () => {
  const base = (): PackageSnapshot => fromCrates(fixture('crate-near-jsonrpc-client.json'));

  it('reports nothing for a package seen for the first time', () => {
    expect(diffPackage(null, base())).toEqual([]);
  });

  it('reports nothing when nothing changed', () => {
    expect(diffPackage(base(), base())).toEqual([]);
  });

  it('reports a new latest version, a newly yanked version and a deprecation, each once', () => {
    const before = base();
    const after = base();
    after.latest_version = '0.24.0';
    after.versions = [...after.versions.map((v) => (v.version === '0.11.0' ? { ...v, yanked: true, yank_message: 'broken build' } : v)), { version: '0.24.0', published_at: '2026-11-01T00:00:00Z', deprecated: null, yanked: false, yank_message: null }];
    after.deprecated = 'every published version is yanked';
    const kinds = diffPackage(before, after).map((e) => `${e.kind}:${e.key}`);
    expect(kinds).toEqual(['package_deprecated:every published version is yanked', 'package_new_latest:0.24.0', 'version_yanked:0.11.0']);
  });

  it('does not report an already yanked version again', () => {
    const before = base();
    const after = base();
    expect(before.versions.some((v) => v.yanked)).toBe(true);
    expect(diffPackage(before, after).filter((e) => e.kind === 'version_yanked')).toEqual([]);
  });
});
