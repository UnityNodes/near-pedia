import { describe, expect, it } from 'vitest';
import { addedImports, rpcHints, rpcParamProblems, rpcShape, type RpcShape } from '@/lib/migrate-checks';

const SEND_TX_PAGE = `POST /send_tx
Sends transaction.

Request body (application/json):
- id (string): JSON-RPC request id.
- method (string, required): one of send_tx
- params (object, required)
  - signed_tx_base64 (string, byte, required)
  - wait_until (string): How long the RPC should wait. one of NONE, FINAL

Responses:
200: no description`;

const shapes: Record<string, RpcShape> = { send_tx: { type: 'object', forms: ['{ signed_tx_base64, wait_until }'] } };
const lookup = (m: string) => shapes[m] ?? null;

describe('rpcShape', () => {
  it('reads the params type and its fields from a written-out RPC reference page', () => {
    expect(rpcShape(SEND_TX_PAGE)).toEqual({ type: 'object', forms: ['{ signed_tx_base64, wait_until }'] });
  });

  it('lists each form of a params object that is one of several', () => {
    const page = `POST /tx_status\n- params (object, required): one of\n  signed_tx_base64:\n    - signed_tx_base64 (string, byte, required)\n  tx_hash, sender_account_id:\n    - sender_account_id (string, required): NEAR Account Identifier.\n    - tx_hash (string, required)\n\nResponses:`;
    expect(rpcShape(page)).toEqual({ type: 'object', forms: ['{ signed_tx_base64 }', '{ tx_hash, sender_account_id }'] });
  });

  it('gives nothing for a page without a params block', () => {
    expect(rpcShape('POST /status\nRequest body:\n- id (string)')).toBeNull();
  });
});

describe('rpcParamProblems', () => {
  it('flags a call whose params are an array where the method takes an object', () => {
    const code = `fetch(url, { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'send_tx', params: [tx] }) });`;
    expect(rpcParamProblems('a.mjs', code, lookup)).toEqual(['send_tx with params as an array; it takes an object: { signed_tx_base64, wait_until }']);
  });

  it('accepts the shape the reference gives, and methods it has no page for', () => {
    expect(rpcParamProblems('a.mjs', `x({ method: 'send_tx', params: { signed_tx_base64: tx } })`, lookup)).toEqual([]);
    expect(rpcParamProblems('a.mjs', `x({ method: 'block', params: [1] })`, lookup)).toEqual([]);
  });

  it('checks only scripts', () => {
    expect(rpcParamProblems('Cargo.toml', `method = "send_tx"`, lookup)).toEqual([]);
  });
});

describe('rpcHints', () => {
  it('states the params shape of each replacement method the reference has', () => {
    expect(rpcHints(['send_tx', 'KeyPairSigner'], lookup)).toEqual(['send_tx takes params as an object: { signed_tx_base64, wait_until }']);
  });
});

describe('addedImports', () => {
  it('names a package the rewrite starts importing', () => {
    const before = `import { connect } from 'near-api-js';\nimport { x } from './config.mjs';`;
    const after = `import { connect } from '@hot-labs/near-connect';\nimport { x } from './config.mjs';`;
    expect(addedImports('w.js', before, after)).toEqual(['@hot-labs/near-connect']);
  });

  it('lets near-api-js, relative paths, node builtins and modules already imported through', () => {
    const before = `import a from 'borsh';`;
    const after = `import a from 'borsh';\nimport { Account } from 'near-api-js';\nimport fs from 'node:fs';\nimport path from 'path';\nimport { y } from '../y.js';\nconst z = require('borsh');`;
    expect(addedImports('w.js', before, after)).toEqual([]);
  });

  it('sees require and dynamic import too', () => {
    expect(addedImports('w.cjs', '', `const s = require('near-seed-phrase'); await import('@near-js/signers');`)).toEqual(['@near-js/signers', 'near-seed-phrase']);
  });
});
