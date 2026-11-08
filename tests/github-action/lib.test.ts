import { describe, expect, it } from 'vitest';
import { MARKER, addedLines, annotation, clip, githubError, isChecked, pullRequestOf, renderComment, shouldFail } from '@/github-action/lib.mjs';

const blob = (file: string, line: number) => `https://github.com/o/r/blob/abc/${file}#L${line}`;
const delegate = {
  severity: 'error', line: 3, matched: 'DelegateV2', via: 'identifier', file: 'src/relay.ts', isNew: true,
  message: 'DelegateV2 was removed in nearcore 2.14.0. Use instead: Delegate.',
  entry: { id: 'delegate-v2', status: 'removed', strength: 'strong', replacement: 'Delegate, signed with a regular access key', replacement_url: 'https://github.com/near/nearcore/releases/tag/2.14.0' },
  sources: [{ url: 'https://github.com/near/nearcore/releases/tag/2.14.0', date: '2026-10-20', signal: 'release_notes' }],
};
const oldVersion = {
  severity: 'warning', line: 1, matched: 'near-api-js ^4.0.0', via: 'version', file: 'package.json', isNew: false, entry: null,
  message: 'near-api-js ^4.0.0 stays on the 4.x line; the latest stable release is 7.4.0.',
  sources: [{ url: 'https://www.npmjs.com/package/near-api-js', date: '2026-10-23', signal: 'registry' }],
};

describe('which files the action reads', () => {
  it('checks NEAR source and manifests, not dependencies, builds or type declarations', () => {
    expect(['src/a.ts', 'contract/src/lib.rs', 'Cargo.toml', 'web/package.json', 'x.mjs'].every(isChecked)).toBe(true);
    expect(['node_modules/near-api-js/lib/index.js', 'target/debug/x.rs', 'types/near.d.ts', 'README.md', 'dist/app.min.js'].some(isChecked)).toBe(false);
  });
});

describe('lines a pull request adds', () => {
  it('numbers added lines by the new file, skipping removed and context lines', () => {
    const patch = ['@@ -1,4 +1,5 @@', ' import a from "a";', '-const x = 1;', '+const x = 2;', '+const y = { DelegateV2: s };', ' end();', '@@ -20,2 +21,3 @@', ' keep();', '+added();', '\\ No newline at end of file'].join('\n');
    expect([...addedLines(patch)]).toEqual([2, 3, 22]);
    expect(addedLines(undefined).size).toBe(0);
  });
});

describe('file size', () => {
  it('cuts a file over the API limit at a line break, so line numbers stay true', () => {
    const big = `${'a'.repeat(19_990)}\nsecond line\n${'b'.repeat(100)}`;
    const { code, cut } = clip(big);
    expect(cut).toBe(true);
    expect(code.endsWith('a')).toBe(true);
    expect(clip('small').cut).toBe(false);
  });
});

describe('the pull request comment', () => {
  it('puts what this pull request adds first, with replacement and source, and the rest folded', () => {
    const body = renderComment({ findings: [oldVersion, delegate], basis: { entries: 137, built_at: '2026-11-03T12:00:00Z' }, skipped: [], site: 'https://near-pedia.xyz', blob });
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('### NEARpedia: 1 line this pull request adds uses something NEAR deprecated, removed or changed');
    expect(body).toContain('| **error** | [src/relay.ts:3](https://github.com/o/r/blob/abc/src/relay.ts#L3) | <code>DelegateV2</code> | removed | [Delegate, signed with a regular access key](https://github.com/near/nearcore/releases/tag/2.14.0) | [github.com](https://github.com/near/nearcore/releases/tag/2.14.0) 2026-10-20 |');
    expect(body).toContain('<summary>1 more in the changed files, on lines this pull request does not touch</summary>');
    expect(body).toContain('| old version | upgrade after reading the release notes |');
    expect(body).toContain('index of 137 NEAR deprecations, built 2026-11-03');
  });

  it('says so plainly when the changed files are clean, and lists what it could not read', () => {
    const body = renderComment({ findings: [], basis: { entries: 137, built_at: null }, skipped: [{ file: 'big.ts', reason: 'only its first 20,000 characters were checked' }], site: 'https://near-pedia.xyz', blob });
    expect(body).toContain('no stale NEAR code in the files this pull request changes');
    expect(body).toContain('<code>big.ts</code> (only its first 20,000 characters were checked)');
  });

  it('never mentions a GitHub user or org that a package scope happens to name', () => {
    const scoped = { ...oldVersion, isNew: true, matched: '@near-js/crypto', message: 'This line depends on @near-js/crypto: use near-api-js 7.x.', entry: { id: 'near-js', status: 'deprecated', strength: 'strong', replacement: 'near-api-js 7.x, not @near-js/*', replacement_url: null } };
    const body = renderComment({ findings: [scoped], basis: null, skipped: [], site: 'https://near-pedia.xyz', blob });
    expect(body).toContain('<code>@near-js/crypto</code>');
    expect(body.replace(/<code>[^<]*<\/code>/g, '')).not.toMatch(/@near-js/);
  });

  it('keeps table cells and code from breaking the markdown', () => {
    const odd = { ...delegate, matched: 'a|b<script>', message: 'two\nlines' };
    const body = renderComment({ findings: [odd], basis: null, skipped: [], site: 'https://near-pedia.xyz', blob });
    expect(body).toContain('<code>a\\|b&lt;script&gt;</code>');
    expect(body).not.toContain('two\nlines');
  });
});

describe('annotations and the exit code', () => {
  it('writes a workflow annotation on the added line, escaped', () => {
    expect(annotation({ ...delegate, file: 'src/a,b.ts', message: '50% done\nnext' })).toBe('::error file=src/a%2Cb.ts,line=3,title=NEARpedia%3A DelegateV2::50%25 done%0Anext');
  });

  it('fails only on what the pull request adds, at the chosen severity', () => {
    expect(shouldFail([delegate], 'error')).toBe(true);
    expect(shouldFail([oldVersion], 'warning')).toBe(false);
    expect(shouldFail([{ ...oldVersion, isNew: true }], 'warning')).toBe(true);
    expect(shouldFail([{ ...oldVersion, isNew: true }], 'error')).toBe(false);
    expect(shouldFail([delegate], 'never')).toBe(false);
  });
});

describe('githubError', () => {
  it('names the unauthenticated rate limit and how to pass a token on a 403 with no calls left', () => {
    const msg = githubError({ status: 403, path: '/repos/o/r/pulls/1/files', body: '{"message":"API rate limit exceeded for 1.2.3.4."}', remaining: '0', reset: '1794121304', hasToken: false });
    expect(msg).toMatch(/60 calls an hour/);
    expect(msg).toMatch(/INPUT_GITHUB-TOKEN/);
    expect(msg).toMatch(/2026-11-0\dT\d\d:\d\d UTC/);
  });

  it('says the token is out of calls when one was given', () => {
    const msg = githubError({ status: 403, path: '/x', body: '', remaining: '0', reset: null, hasToken: true });
    expect(msg).toMatch(/token has no calls left/);
    expect(msg).not.toMatch(/INPUT_GITHUB-TOKEN/);
  });

  it('keeps a plain 403 that is not the rate limit as a permission problem', () => {
    const msg = githubError({ status: 403, path: '/x', body: '{"message":"Resource not accessible by integration"}', remaining: '4999', reset: null, hasToken: true });
    expect(msg).toMatch(/permission/);
    expect(msg).toContain('Resource not accessible by integration');
  });

  it('falls back to the status and the start of the body otherwise', () => {
    expect(githubError({ status: 404, path: '/x', body: 'Not Found', remaining: null, reset: null, hasToken: false })).toBe('GitHub GET /x: 404 Not Found');
  });
});

describe('pullRequestOf', () => {
  it('returns the pull request of a normal event', () => {
    expect(pullRequestOf({ pull_request: { number: 3, head: {} } })).toMatchObject({ number: 3 });
  });

  it('turns a dry-run event built from a rate-limited curl into a clear error', () => {
    expect(() => pullRequestOf({ pull_request: { message: 'API rate limit exceeded for 1.2.3.4.' } })).toThrow(/rate limit.*curl/i);
  });

  it('returns null when the event has no pull request', () => {
    expect(pullRequestOf({ push: {} })).toBeNull();
  });
});
