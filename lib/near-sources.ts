/**
 * What the NEAR syncs read. One list per source so a sync, its completeness
 * check and the /sources page all name the same things.
 *
 * Chosen 2026-11-01 from the NEAR developer surface: the node, the Rust and JS
 * SDKs and clients, the CLIs and build tools, the wallet connectors and the
 * packages agents most often reach for from memory, including the ones that
 * are now archived (near-sdk-js, near-cli) because those are what stale code
 * imports.
 */

export const GITHUB_ORGS = [
  'near',
  'nearai',
  'near-examples',
  'Near-One',
  'defuse-protocol',
  'houseofstake',
  'fastnear',
  'aurora-is-near',
] as const;

export const NPM_PACKAGES = [
  'near-api-js',
  'near-sdk-js',
  'near-cli',
  'near-workspaces',
  'create-near-app',
  'near-seed-phrase',
  '@hot-labs/near-connect',
] as const;

/** Scopes whose every package is tracked; discovered through npm search. */
export const NPM_SCOPES = ['@near-js', '@near-wallet-selector', '@defuse-protocol'] as const;

export const CRATES = [
  'near-sdk',
  'near-sdk-macros',
  'near-sys',
  'near-contract-standards',
  'near-sdk-sim',
  'near-workspaces',
  'near-api',
  'near-api-types',
  'near-jsonrpc-client',
  'near-jsonrpc-primitives',
  'near-primitives',
  'near-crypto',
  'near-account-id',
  'near-gas',
  'near-token',
  'near-abi',
  'cargo-near',
  'cargo-near-build',
  'near-cli-rs',
  'near-lake-framework',
  'near-indexer-primitives',
  'omni-transaction',
] as const;
