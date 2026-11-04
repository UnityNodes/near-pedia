import { describe, expect, it } from 'vitest';
import {
  addedCommentLines, applyEdits, editsFrom, isImprovement, mentionOnly, mentionsKept, missingNearApi, needsHand, parseErrors, renderReport, repoFrom,
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

  it('tells a name the code uses from one a string or a comment only mentions, and counts module names as code', () => {
    const at = (line: number, matched: string) => finding({ line, matched });
    const code = [
      "import { keyStores } from 'near-api-js';",
      "import { Account } from '@near-js/accounts';",
      "const lib = require('@near-js/providers');",
      "const q = 'What replaces keyStores in near-api-js 7?';",
      '// keyStores went away in v7',
      'const ks = new keyStores.InMemoryKeyStore();',
      'const msg = `store: ${keyStores.InMemoryKeyStore.name}`;',
      'const chips = [`DelegateV2`, "near-sdk-js"];',
    ].join('\n');
    expect(mentionOnly('a.ts', code, at(1, 'keyStores'))).toBe(false);
    expect(mentionOnly('a.ts', code, at(2, '@near-js/accounts'))).toBe(false);
    expect(mentionOnly('a.ts', code, at(3, '@near-js/providers'))).toBe(false);
    expect(mentionOnly('a.ts', code, at(4, 'keyStores'))).toBe(true);
    expect(mentionOnly('a.ts', code, at(5, 'keyStores'))).toBe(true);
    expect(mentionOnly('a.ts', code, at(6, 'keyStores'))).toBe(false);
    expect(mentionOnly('a.ts', code, at(7, 'keyStores'))).toBe(false);
    expect(mentionOnly('a.ts', code, at(8, 'DelegateV2'))).toBe(true);
    expect(mentionOnly('src/lib.rs', '// keyStores', at(1, 'keyStores'))).toBe(false);
  });

  it('counts an endpoint, an RPC method or a config key written as a bare string value as code, and the same name in a sentence as a mention', () => {
    const code = [
      "const RPC = 'https://rpc.testnet.pagoda.co';",
      "const body = { method: 'broadcast_tx_commit' };",
      "const note = 'rpc.testnet.pagoda.co is gone, use another endpoint';",
      '// call broadcast_tx_commit',
      "const label = 'DelegateV2';",
      "const page = '/post-broadcast_tx_commit';",
    ].join('\n');
    const at = (line: number, matched: string, via: Finding['via']) => finding({ line, matched, via });
    expect(mentionOnly('a.mjs', code, at(1, 'rpc.testnet.pagoda.co', 'url'))).toBe(false);
    expect(mentionOnly('a.mjs', code, at(2, 'broadcast_tx_commit', 'rpc'))).toBe(false);
    expect(mentionOnly('a.mjs', code, at(3, 'rpc.testnet.pagoda.co', 'url'))).toBe(true);
    expect(mentionOnly('a.mjs', code, at(4, 'broadcast_tx_commit', 'rpc'))).toBe(true);
    expect(mentionOnly('a.mjs', code, at(5, 'DelegateV2', 'identifier'))).toBe(true);
    expect(mentionOnly('a.mjs', code, at(6, 'broadcast_tx_commit', 'rpc'))).toBe(true);
  });

  it('refuses a rewrite that edits the text that only mentions an old name', () => {
    const original = "import { keyStores } from 'near-api-js';\nconst q = 'What replaces keyStores?';\nnew keyStores.InMemoryKeyStore();\n";
    const before = [finding({ line: 1 }), finding({ line: 2 }), finding({ line: 3 })];
    const good = "import { KeyPairSigner } from 'near-api-js';\nconst q = 'What replaces keyStores?';\nKeyPairSigner.fromSecretKey(k);\n";
    const bad = "import { KeyPairSigner } from 'near-api-js';\nconst q = 'What replaces KeyPairSigner?';\nKeyPairSigner.fromSecretKey(k);\n";
    expect(mentionsKept('a.ts', original, good, before, [finding({ line: 2 })])).toBe(true);
    expect(mentionsKept('a.ts', original, bad, before, [])).toBe(false);
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
  it('marks as open what a migrated file still carries, by name, wherever its lines moved, and states each repeated finding once', () => {
    const r: MigrationResult = {
      repo: { owner: 'acme', repo: 'relayer', branch: null, url: 'https://github.com/acme/relayer' },
      scanned: 1,
      results: [{
        file: 'relay.mjs',
        before: [finding({ line: 1 }), finding({ line: 7 }), finding({ line: 19, matched: 'broadcast_tx_commit', via: 'rpc', message: 'broadcast_tx_commit is deprecated.' })],
        after: [finding({ line: 17, matched: 'broadcast_tx_commit', via: 'rpc', message: 'broadcast_tx_commit is deprecated.' })],
        status: 'migrated', reason: null, receipt: null,
      }],
      patch: 'diff', apiVersion: '7.4.0', apiGaps: [],
    };
    const md = renderReport(r, 'p.patch');
    expect(md).toContain('This delivery fixes 2 of them in 1 file.');
    expect(md).toContain('- fixed · lines 1, 7 · `keyStores`: keyStores is deprecated.');
    expect(md).toContain('- open · line 17 · `broadcast_tx_commit`: broadcast_tx_commit is deprecated.');
    expect(md.match(/keyStores is deprecated/g)).toHaveLength(1);
  });

  it('says what was fixed, what is left and why, how to apply the patch, and what still blocks near-api-js 7', () => {
    const r: MigrationResult = {
      repo: { owner: 'acme', repo: 'relayer', branch: null, url: 'https://github.com/acme/relayer' },
      scanned: 9,
      results: [
        { file: 'lib/near.mjs', before: [finding()], after: [], status: 'migrated', reason: null, receipt: { verify_url: 'https://cloud.near.ai/verify#x' } as never },
        { file: 'src/ui.ts', before: [finding({ line: 4 })], after: [finding({ line: 4 })], status: 'unchanged', reason: 'only mentioned in strings or comments, which the patch leaves as they are', receipt: null },
        { file: 'package.json', before: [finding({ matched: 'near-api-js ^5.1.1', via: 'version', entry: null })], after: [finding({ via: 'version', entry: null })], status: 'manual', reason: 'change the dependency once the code builds', receipt: null },
      ],
      patch: 'diff --git a/lib/near.mjs b/lib/near.mjs',
      apiVersion: '7.4.0',
      apiGaps: [{ file: 'lib/near.mjs', names: ['connect'] }],
    };
    const md = renderReport(r, 'nearpedia-migration.patch');
    expect(md).toContain('3 use something NEAR deprecated, removed or changed: 3 findings. This delivery fixes 1 of them in 1 file.');
    expect(md).toContain('1 of those files only name an old API inside strings or comments (1 finding).');
    expect(md).toContain('- mentioned · line 4 · `keyStores`');
    expect(md).not.toMatch(/mentioned · line 4 · `keyStores`: /);
    expect(md).toContain('git apply nearpedia-migration.patch');
    expect(md).toContain('| `package.json` | 1 | 1 | by hand: change the dependency once the code builds |');
    expect(md).toContain('- `lib/near.mjs`: `connect`');
    expect(md).toContain('That does not prove the code runs: build it and run your tests.');
  });
});
