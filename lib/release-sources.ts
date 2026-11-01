/**
 * The products whose GitHub releases NEAR-pedia serves, and the repositories
 * the releases sync reads to get them.
 *
 * A product is not a repository. near-sdk-rs releases near-sdk,
 * near-sdk-macros, near-sys and five more crates from one repo, each under
 * its own tag prefix (`near-sdk-v5.30.0`, `near-sys-v0.4.0`), and
 * near-api-js tags every @near-js/* package next to the main one. Taking the
 * repo as the product served "near-sdk-rs near-sys-v0.4.0" as an SDK release.
 * So each product names its repository and the tag prefixes that are its
 * own, most specific first; a repo's older history often used plain `v1.2.3`
 * or bare `1.2.3` tags before it went multi-package, and those belong to the
 * main product. Tags that match no product are kept in github_releases but
 * not served as a product's release.
 *
 * Prefixes checked against the live tags on 2026-11-01. near-sdk-js stays
 * although archived: its last release is what stale code pins.
 */

export interface ReleaseProductSpec {
  key: string;
  label: string;
  repo: string;
  tagPrefixes: readonly string[];
}

export const RELEASE_PRODUCT_SPECS: readonly ReleaseProductSpec[] = [
  { key: 'nearcore', label: 'nearcore', repo: 'near/nearcore', tagPrefixes: [''] },
  { key: 'near-sdk', label: 'near-sdk (Rust)', repo: 'near/near-sdk-rs', tagPrefixes: ['near-sdk-v', 'v', ''] },
  { key: 'near-api-js', label: 'near-api-js', repo: 'near/near-api-js', tagPrefixes: ['near-api-js@', 'v'] },
  { key: 'near-api', label: 'near-api (Rust)', repo: 'near/near-api-rs', tagPrefixes: ['near-api-v', 'v'] },
  { key: 'near-cli-rs', label: 'near-cli-rs', repo: 'near/near-cli-rs', tagPrefixes: ['v', ''] },
  { key: 'cargo-near', label: 'cargo-near', repo: 'near/cargo-near', tagPrefixes: ['cargo-near-v', 'v'] },
  { key: 'near-workspaces', label: 'near-workspaces (Rust)', repo: 'near/near-workspaces-rs', tagPrefixes: ['near-workspaces-v', 'v', ''] },
  { key: 'near-jsonrpc-client', label: 'near-jsonrpc-client (Rust)', repo: 'near/near-jsonrpc-client-rs', tagPrefixes: ['v'] },
  { key: 'mpc', label: 'MPC (Chain Signatures)', repo: 'near/mpc', tagPrefixes: [''] },
  { key: 'near-sdk-js', label: 'near-sdk-js (archived)', repo: 'near/near-sdk-js', tagPrefixes: ['v'] },
];

export const RELEASE_REPOS: readonly string[] = [...new Set(RELEASE_PRODUCT_SPECS.map((p) => p.repo))];

const VERSION_START = /^\d+\.\d+/;

/**
 * The version a tag carries for this product, or null when the tag belongs
 * to another package in the same repository. A prefix only matches when what
 * follows it starts like a version, so the bare '' prefix takes `2.14.0` and
 * never `near-sys-v0.4.0`.
 */
export function versionFromTag(product: Pick<ReleaseProductSpec, 'tagPrefixes'>, tag: string): string | null {
  for (const prefix of product.tagPrefixes) {
    if (!tag.startsWith(prefix)) continue;
    const rest = tag.slice(prefix.length);
    if (VERSION_START.test(rest)) return rest;
  }
  return null;
}

/** The product a tag in this repository belongs to, with its version, or null for another package's tag. */
export function productOfTag(repo: string, tag: string): { product: ReleaseProductSpec; version: string } | null {
  for (const product of RELEASE_PRODUCT_SPECS) {
    if (product.repo !== repo) continue;
    const version = versionFromTag(product, tag);
    if (version !== null) return { product, version };
  }
  return null;
}

export function repoName(repo: string): string {
  return repo.split('/')[1] ?? repo;
}
