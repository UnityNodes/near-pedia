import { describe, expect, it } from 'vitest';
import { detectLanguage, packageOfSpecifier, scanCode } from '@/lib/code-scan';
import { stripRustComments, stripTomlComments } from '@/lib/strip-comments';

describe('detectLanguage', () => {
  it.each([
    ['contract.ts', 'x', 'js'],
    ['lib.rs', 'x', 'rust'],
    ['Cargo.toml', 'x', 'cargo'],
    ['app/package.json', '{}', 'package-json'],
    ['config.json', '{"state_sync": {}}', 'json'],
  ])('%s -> %s', (file, code, expected) => {
    expect(detectLanguage(code, file)).toBe(expected);
  });

  it('guesses from the content without a filename', () => {
    expect(detectLanguage('[dependencies]\nnear-sdk = "5"')).toBe('cargo');
    expect(detectLanguage('use near_sdk::near;\n#[near(contract_state)]\npub struct C {}')).toBe('rust');
    expect(detectLanguage('{ "dependencies": { "near-api-js": "^4.0.0" } }')).toBe('package-json');
    expect(detectLanguage("import { NearBindgen } from 'near-sdk-js';")).toBe('js');
  });
});

describe('scanCode: JavaScript and TypeScript', () => {
  const code = [
    "import { NearBindgen, call } from 'near-sdk-js';",
    "import type { Account } from '@near-js/accounts/lib/account';",
    'import {',
    '  connect,',
    "} from 'near-api-js';",
    "const { setupWalletSelector } = require('@near-wallet-selector/core');",
    "// import { old } from 'near-cli';",
    "const lazy = await import('@near-lake/framework');",
    "export { thing } from './local';",
  ].join('\n');

  it('finds every import form with its line, and none in a comment', () => {
    const s = scanCode(code, 'x.ts');
    expect(s.imports.map((i) => [i.module, i.line])).toEqual([
      ['near-sdk-js', 1],
      ['@near-js/accounts/lib/account', 2],
      ['near-api-js', 5],
      ['./local', 9],
      ['@near-wallet-selector/core', 6],
      ['@near-lake/framework', 8],
    ]);
    expect(s.text.split('\n')).toHaveLength(9);
  });

  it('reduces a specifier to its package', () => {
    expect(packageOfSpecifier('@near-js/accounts/lib/account')).toBe('@near-js/accounts');
    expect(packageOfSpecifier('near-sdk-js/lib/api')).toBe('near-sdk-js');
    expect(packageOfSpecifier('./local')).toBeNull();
    expect(packageOfSpecifier('node:fs')).toBeNull();
  });
});

describe('scanCode: Rust', () => {
  it('finds crate roots of use and extern crate, not std or crate paths, not in comments', () => {
    const code = 'use near_sdk::{near, env};\npub use near_lake_framework::LakeConfig;\nuse std::collections::HashMap;\nuse crate::x;\n// use near_sdk_sim::init;\n/* use a::b; /* nested */ still */\nextern crate near_primitives;';
    expect(scanCode(code, 'lib.rs').imports.map((i) => [i.module, i.line])).toEqual([
      ['near_sdk', 1], ['near_lake_framework', 2], ['near_primitives', 7],
    ]);
  });

  it('keeps string, raw-string and char literals and line breaks while blanking comments', () => {
    const code = 'let m = "EXPERIMENTAL_tx_status"; // DelegateV2\nlet r = r#"a // not a comment"#;\nlet c = \'"\'; let l: &\'a str;\n/* x\n y */ z';
    const out = stripRustComments(code);
    expect(out).toContain('"EXPERIMENTAL_tx_status"');
    expect(out).not.toContain('DelegateV2');
    expect(out).toContain('r#"a // not a comment"#');
    expect(out).toContain("'\"'");
    expect(out.split('\n')).toHaveLength(code.split('\n').length);
    expect(out).toMatch(/ z$/);
  });
});

describe('scanCode: Cargo.toml', () => {
  const toml = [
    '[package]',
    'name = "my-contract"',
    'version = "0.1.0"',
    '',
    '[dependencies]',
    'near-sdk = { version = "4.1.1", features = ["legacy"] } # pinned',
    'near-jsonrpc-client = "=0.10.2"',
    'sdk-alias = { package = "near-workspaces", version = "0.9" }',
    'local = { path = "../local" }',
    'shared.workspace = true',
    '',
    '[dev-dependencies]',
    'near-sdk-sim = "3.2.0"',
    '# near-lake-framework = "0.7"',
  ].join('\n');

  it('reads every dependency with its version requirement and line', () => {
    expect(scanCode(toml, 'Cargo.toml').dependencies.map((d) => [d.name, d.spec, d.line])).toEqual([
      ['near-sdk', '4.1.1', 6],
      ['near-jsonrpc-client', '=0.10.2', 7],
      ['near-workspaces', '0.9', 8],
      ['local', null, 9],
      ['shared', null, 10],
      ['near-sdk-sim', '3.2.0', 13],
    ]);
  });

  it('blanks TOML comments but not a # inside a string', () => {
    expect(stripTomlComments('a = "x#y" # c')).toBe('a = "x#y"    ');
  });
});

describe('scanCode: package.json', () => {
  it('reads dependencies of every section, dropping git, file and workspace specs', () => {
    const json = JSON.stringify({
      name: 'app',
      dependencies: { 'near-api-js': '^4.0.0', '@near-wallet-selector/core': '8.9.0', 'my-fork': 'github:me/fork' },
      devDependencies: { 'near-workspaces': '~5.0.0', local: 'file:../x' },
    }, null, 2);
    const deps = scanCode(json, 'package.json').dependencies;
    expect(deps.map((d) => [d.name, d.spec])).toEqual([
      ['near-api-js', '^4.0.0'], ['@near-wallet-selector/core', '8.9.0'], ['my-fork', null],
      ['near-workspaces', '~5.0.0'], ['local', null],
    ]);
    expect(deps[0].line).toBe(4);
  });

  it('returns no dependencies for invalid JSON instead of throwing', () => {
    expect(scanCode('{ "dependencies": ', 'package.json').dependencies).toEqual([]);
  });
});

describe('review fixes: Cargo.toml forms', () => {
  it('reads [dependencies.name] tables, dotted and quoted keys, and inline tables over several lines', () => {
    const toml = [
      '[dependencies.near-sdk]',
      'version = "4.1.1"',
      'features = ["legacy"]',
      '',
      '[dependencies]',
      '"near-gas" = "0.2"',
      'near-token.version = "0.3"',
      'near-account-id = {',
      '  version = "1.0",',
      '  features = ["serde"],',
      '}',
      '',
      '[target.\'cfg(unix)\'.dev-dependencies.near-sdk-sim]',
      'version = "3.2.0"',
    ].join('\n');
    expect(scanCode(toml, 'Cargo.toml').dependencies.map((d) => [d.name, d.spec, d.line])).toEqual([
      ['near-sdk', '4.1.1', 1],
      ['near-gas', '0.2', 6],
      ['near-token', '0.3', 7],
      ['near-account-id', '1.0', 8],
      ['near-sdk-sim', '3.2.0', 13],
    ]);
  });

  it('recognises a Cargo manifest that only has dependency tables', () => {
    expect(detectLanguage('[dependencies.near-sdk]\nversion = "5"')).toBe('cargo');
  });
});

describe('review fixes: package.json edge cases', () => {
  it('reports invalid JSON, a non-object and a BOM-prefixed file instead of throwing or going quiet', () => {
    expect(scanCode('{ "dependencies": ', 'package.json').problems[0]).toMatch(/not valid JSON/);
    expect(scanCode('null', 'package.json').problems[0]).toMatch(/not a JSON object/);
    expect(scanCode('﻿{"dependencies":{"near-api-js":"^4.0.0"}}', 'package.json').dependencies).toHaveLength(1);
  });

  it('puts a dependency on its own section line, not on a scripts line naming it', () => {
    const json = '{\n  "scripts": { "near-api-js": "echo" },\n  "dependencies": {\n    "near-api-js": "^4.0.0"\n  }\n}';
    expect(scanCode(json, 'package.json').dependencies[0].line).toBe(4);
  });
});

describe('review fixes: Rust', () => {
  it('finds use after a semicolon, inside a module block and in a braced group', () => {
    const code = 'use a::b; use near_sdk_sim::init;\nmod t { use near_lake_framework::X; }\nuse {near_primitives::types};';
    expect(scanCode(code, 'lib.rs').imports.map((i) => i.module)).toEqual(['a', 'near_sdk_sim', 'near_lake_framework', 'near_primitives']);
  });

  it('keeps a multi-line string whole', () => {
    const out = stripRustComments('let s = "{\n url: https://rpc.mainnet.pagoda.co\n}"; // c');
    expect(out).toContain('https://rpc.mainnet.pagoda.co');
    expect(out).not.toContain('// c');
  });
});

describe('review fixes: speed', () => {
  it('scans 100k characters of import words quickly', () => {
    const started = Date.now();
    scanCode('import '.repeat(14_000), 'a.ts');
    expect(Date.now() - started).toBeLessThan(500);
  });
});
