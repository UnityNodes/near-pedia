import { describe, expect, it } from 'vitest';
import {
  addedCommentLines, applyEdits, editsFrom, isImprovement, missingNearApi, needsHand, parseErrors, renderReport, repoFrom,
  replacementNames, undeclaredNames, type MigrationResult, type NearApiExports,
} from '@/lib/migrate-repo';
import type { Finding } from '@/lib/check-code';

const finding = (over: Partial<Finding> = {}): Finding => ({
  severity: 'warning', line: 2, code: '', matched: 'keyStores', via: 'identifier', message: 'keyStores is deprecated. Use instead: a KeyPairSigner.',
  entry: { id: 'near-api-js-keystores', title: 't', status: 'deprecated', strength: 'strong', summary: '', replacement: 'a KeyPairSigner, or a KeyPairString passed to new Account()', replacement_url: null, effective: null, since: null, origin: 'seed', stale: false, contested: false },
  sources: [{ url: 'https://github.com/near/near-api-js/releases/tag/v7.0.0', date: '2026-01-19', signal: 'release' }],
  ...over,
});

const api: NearApiExports = {
  version: '7.4.0',
  names: ['Account', 'JsonRpcProvider', 'KeyPair', 'KeyPairSigner', 'actions'],
  statics: new Map([['Account', new Set()], ['JsonRpcProvider', new Set()], ['KeyPair', new Set(['fromString', 'fromRandom'])], ['KeyPairSigner', new Set(['fromSecretKey'])], ['actions', new Set(['transfer'])]]),
};

describe('reading the job', () => {
  it('finds the repository and branch a buyer links, and nothing in a brief without one', () => {
    expect(repoFrom('Please migrate https://github.com/acme/relayer.git, thanks')).toEqual({ owner: 'acme', repo: 'relayer', branch: null, url: 'https://github.com/acme/relayer' });
    expect(repoFrom('see https://github.com/acme/relayer/tree/dev).')?.branch).toBe('dev');
    expect(repoFrom('my repo is private')).toBeNull();
    expect(repoFrom('https://github.com/acme/relayer/tree/--upload-pack=touch')).toBeNull();
    expect(repoFrom('https://github.com/acme/relayer/tree/a/../b')).toBeNull();
  });
});

describe('what the model may change', () => {
  it('reads a JSON list of edits, also inside a code fence, and refuses anything else', () => {
    expect(editsFrom('```json\n[{"find":"a","replace":"b"}]\n```')).toEqual([{ find: 'a', replace: 'b' }]);
    expect(editsFrom('here is the file: const a = 1')).toBeNull();
    expect(editsFrom('[{"find":"","replace":"b"}]')).toBeNull();
  });

  it('applies an edit only where its text appears exactly once', () => {
    expect(applyEdits('a\nb\n', [{ find: 'b', replace: 'c' }])).toEqual({ text: 'a\nc\n' });
    expect(applyEdits('a\na\n', [{ find: 'a', replace: 'c' }])).toEqual({ error: 'an edit matches the file more than once' });
    expect(applyEdits('a\n', [{ find: 'z', replace: 'c' }])).toEqual({ error: 'an edit does not match the file' });
  });

  it('keeps a rewrite only when it removes findings and adds none', () => {
    const a = finding();
    const b = finding({ line: 9, matched: 'actionCreators', entry: { ...finding().entry!, id: 'near-api-js-action-creators' } });
    expect(isImprovement([a, b], [a])).toBe(true);
    expect(isImprovement([a], [a])).toBe(false);
    expect(isImprovement([a], [b])).toBe(false);
  });

  it('leaves a near-sdk-js contract to a person: moving it means rewriting it in Rust', () => {
    expect(needsHand([finding({ entry: { ...finding().entry!, id: 'near-sdk-js' } })])).toBe(true);
    expect(needsHand([finding()])).toBe(false);
  });
});

describe('checking a rewrite before it is kept', () => {
  it('catches a file that no longer parses', () => {
    expect(parseErrors('a.mjs', 'const a = 1;\nconst a = ;')).not.toEqual([]);
    expect(parseErrors('a.mjs', 'export const a = 1;')).toEqual([]);
    expect(parseErrors('Cargo.toml', '[[[')).toEqual([]);
  });

  it('counts commentary the model added', () => {
    expect(addedCommentLines('a();\n', '// Wait, the original...\n// so we should\na();\n')).toBe(2);
  });

  it('names what near-api-js does not export, down to static methods, through import, require and import()', () => {
    const code = [
      "import { KeyPair, KeyPairSigner, connect } from 'near-api-js';",
      "const { keyStores } = require('near-api-js');",
      "const lib = await import('near-api-js');",
      'KeyPairSigner.from(KeyPair.fromString(k)); KeyPairSigner.fromSecretKey(k); lib.utils.format; lib.actions.transfer;',
    ].join('\n');
    expect(missingNearApi('a.mjs', code, api)).toEqual(['KeyPairSigner.from', 'connect', 'keyStores', 'utils']);
  });

  it('names what a file uses without declaring or importing it, and not Node globals', () => {
    const code = "import { KeyPair } from 'near-api-js';\nexport const f = (k) => new Account('a', new KeyPairSigner(KeyPair.fromString(k)), Buffer.from(process.env.X ?? ''));\n";
    expect(undeclaredNames('a.mjs', code)).toEqual(['Account', 'KeyPairSigner']);
  });

  it('looks up the docs of each replacement the findings name', () => {
    expect(replacementNames([finding(), finding({ entry: { ...finding().entry!, replacement: 'send_tx' } })])).toEqual(['KeyPairSigner', 'KeyPairString', 'send_tx']);
  });
});

describe('the deliverable', () => {
  it('says what was fixed, what is left and why, how to apply the patch, and what still blocks near-api-js 7', () => {
    const r: MigrationResult = {
      repo: { owner: 'acme', repo: 'relayer', branch: null, url: 'https://github.com/acme/relayer' },
      scanned: 9,
      results: [
        { file: 'lib/near.mjs', before: [finding()], after: [], status: 'migrated', reason: null, receipt: { verify_url: 'https://cloud.near.ai/verify#x' } as never },
        { file: 'package.json', before: [finding({ matched: 'near-api-js ^5.1.1', via: 'version', entry: null })], after: [finding({ via: 'version', entry: null })], status: 'manual', reason: 'change the dependency once the code builds', receipt: null },
      ],
      patch: 'diff --git a/lib/near.mjs b/lib/near.mjs',
      apiVersion: '7.4.0',
      apiGaps: [{ file: 'lib/near.mjs', names: ['connect'] }],
    };
    const md = renderReport(r, 'nearpedia-migration.patch');
    expect(md).toContain('2 use something NEAR deprecated, removed or changed: 2 findings. This delivery fixes 1 of them in 1 files.');
    expect(md).toContain('git apply nearpedia-migration.patch');
    expect(md).toContain('| `package.json` | 1 | 1 | by hand: change the dependency once the code builds |');
    expect(md).toContain('- `lib/near.mjs`: `connect`');
    expect(md).toContain('That does not prove the code runs: build it and run your tests.');
  });
});
