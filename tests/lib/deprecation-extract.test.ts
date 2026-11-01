import { describe, expect, it } from 'vitest';
import { bulletSentence, extractDocsMarker, extractReleaseRemovals } from '@/lib/deprecation-extract';

// Lines as the GitHub releases carry them (2026-11-01).
const NEARCORE_2_14 = `\`\`\`
CODE_COLOR: CODE_YELLOW_MAINNET
\`\`\`

# Protocol Changes
* Remove gas rewards: executing a \`FunctionCall\` no longer pays part of the burned gas back to the contract account as a reward. The \`burnt_gas_reward\` parameter is changed from 30% (3/10) to 0%.
* Removed the \`DelegateV2\` meta-transaction action introduced in 2.13.0. A new transaction or receipt carrying it is now rejected at action validation with the new \`ActionsValidationError::RemovedProtocolFeature\` error.
* Removed the option to disable state snapshots. Nodes now always take a state snapshot every epoch.

# Non-protocol Changes
* Removed the long-deprecated \`num_block_producer_seats_per_shard\`, \`avg_hidden_validator_seats_per_shard\`, and \`num_chunk_only_producer_seats\` fields from \`EpochConfig\`.
* Stabilized \`EXPERIMENTAL_tx_status\` and renamed it to \`tx_status\`. \`EXPERIMENTAL_tx_status\` keeps working as a deprecated alias.
* Stabilized \`EXPERIMENTAL_receipt\`.
`;

const NEAR_API_JS_7 = `### Major Changes

-   [#1669](https://github.com/near/near-api-js/pull/1669) [\`683e1db\`](https://github.com/near/near-api-js/commit/683e1dbd17008c618cda6d5c3cb9e7994ceb2d55) Thanks [@denbite](https://github.com/denbite)! - Remove no longer maintained packages \`@near-js/iframe-rpc\`, \`@near-js/biometric-ed25519\` and \`@near-js/client\` with \`@near-js/cookbook\` examples
-   [#1752](https://github.com/near/near-api-js/pull/1752) [\`e6c61ae\`](https://github.com/near/near-api-js/commit/e6c61ae) Thanks [@denbite](https://github.com/denbite)! - Remove redundant \`null\` argument from \`Provider.viewValidators\` method
-   [#1805](https://github.com/near/near-api-js/pull/1805) [\`9356419\`](https://github.com/near/near-api-js/commit/9356419) Thanks [@denbite](https://github.com/denbite)! - Remove no longer needed error utils like \`getErrorTypeFromErrorMessage\`, \`parseRpcError\`, \`parseResultError\`, etc from the package

### Patch Changes

- remove the \`EXPERIMENTAL_view_gas_key\` / \`EXPERIMENTAL_view_gas_key_list\` methods, dropped by nearcore
- deprecate \`GasKeyAlreadyExistsActionError\`, \`GasKeyPermissionInvalidActionError\` and \`GasKeyTooManyNoncesRequestedActionError\`
`;

const NEAR_SDK_FIXES = `### Fixed

- remove correct indices on drop in \`Vec\` drain ([#1595](https://github.com/near/near-sdk-rs/pull/1595))
- remove stale entries for a partially consumed \`Drain\` after drop

### Other

- remove \`global-contracts\` feature gates ([#1507](https://github.com/near/near-sdk-rs/pull/1507))
`;

describe('extractReleaseRemovals', () => {
  it('takes what nearcore 2.14.0 removes, not the words around it', () => {
    const r = extractReleaseRemovals(NEARCORE_2_14);
    expect(r.map((x) => [x.action, x.removed])).toEqual([
      ['removed', ['DelegateV2']],
      ['removed', ['num_block_producer_seats_per_shard', 'avg_hidden_validator_seats_per_shard', 'num_chunk_only_producer_seats']],
      ['deprecated', ['EXPERIMENTAL_tx_status']],
    ]);
  });

  it('keeps every backticked name of the line for matching, gas rewards included', () => {
    const gas = extractReleaseRemovals(NEARCORE_2_14).find((x) => x.removed.includes('DelegateV2'));
    expect(gas?.mentioned).toContain('ActionsValidationError::RemovedProtocolFeature');
  });

  it('skips a removal with a colon between the verb and the first backtick', () => {
    expect(extractReleaseRemovals(NEARCORE_2_14).some((x) => x.mentioned.includes('burnt_gas_reward'))).toBe(false);
  });

  it('reads changeset bullets of near-api-js 7, dropping syntax words', () => {
    const r = extractReleaseRemovals(NEAR_API_JS_7);
    expect(r.map((x) => [x.action, x.removed])).toEqual([
      ['removed', ['@near-js/iframe-rpc', '@near-js/biometric-ed25519', '@near-js/client']],
      ['removed', ['getErrorTypeFromErrorMessage', 'parseRpcError', 'parseResultError']],
      ['removed', ['EXPERIMENTAL_view_gas_key', 'EXPERIMENTAL_view_gas_key_list']],
      ['deprecated', ['GasKeyAlreadyExistsActionError', 'GasKeyPermissionInvalidActionError', 'GasKeyTooManyNoncesRequestedActionError']],
    ]);
  });

  it('leaves the bullets of a Fixed section alone and keeps a removed feature gate', () => {
    expect(extractReleaseRemovals(NEAR_SDK_FIXES).map((x) => x.removed)).toEqual([['global-contracts']]);
  });

  it('takes the fields after the colon, not the configs they were removed from (nearcore 2.12.0)', () => {
    const body = '# Non-protocol Changes\n* Removed deprecated fields from `EpochConfig`, `GenesisConfig`, and `ProtocolConfigView`: `num_block_producer_seats_per_shard`, `avg_hidden_validator_seats_per_shard`, `num_chunk_only_producer_seats`.';
    expect(extractReleaseRemovals(body).map((x) => x.removed)).toEqual([['num_block_producer_seats_per_shard', 'avg_hidden_validator_seats_per_shard', 'num_chunk_only_producer_seats']]);
  });

  it.each([
    ['an internal cleanup', '### Patch Changes\n- Remove a redundant `assert` call in `@near-js/providers`'],
    ['a compiler diagnostic', '### Other\n- remove `double_contract_state_error` diagnostic'],
    ['an upgrade instruction (nearcore 2.13.0)', '## Upgrade instructions\n* Remove the `state_sync.sync` block, **or** set `"state_sync": { "sync": "Peers" }`.'],
  ])('ignores %s', (_what, body) => {
    expect(extractReleaseRemovals(body)).toEqual([]);
  });

  it('reads headings of notes with CRLF line ends, as GitHub serves them', () => {
    const body = '# [NOTE] Check your `state_sync.sync` setting in config.json\r\n* Remove the `state_sync.sync` block.\r\n\r\n# Protocol Changes\r\n* Removed the `DelegateV2` action.\r\n';
    expect(extractReleaseRemovals(body).map((x) => x.removed)).toEqual([['DelegateV2']]);
  });

  it.each([
    ['a removed limit', '### Major Changes\n- Removed the `max_gas` limit on view calls'],
    ['a removed dependency', '### Major Changes\n- Removed `serde_json` dependency'],
  ])('ignores %s, which relaxes rather than breaks callers', (_what, body) => {
    expect(extractReleaseRemovals(body)).toEqual([]);
  });

  it('reads a removal behind a Breaking label or a conventional-commit prefix', () => {
    expect(extractReleaseRemovals('### Changes\n- **Breaking:** Removed the `OldAction` action\n- feat!: remove `legacy_call` method').map((x) => x.removed))
      .toEqual([['OldAction'], ['legacy_call']]);
  });

  it('strips a release-plz prefix down to the sentence', () => {
    expect(bulletSentence('- [#4363](https://github.com/near/mpc/pull/4363)(@pbeza): *(contract)* Drop `Option` from `tee_verifier_account_id` (#4363)'))
      .toBe('Drop `Option` from `tee_verifier_account_id`');
  });
});

describe('extractDocsMarker on docs.near.org RPC reference pages (2026-11-01)', () => {
  it('reads a deprecated method and the successor it names', () => {
    const page = '/openapi.json post /broadcast_tx_async\n[Deprecated] Sends a transaction and immediately returns transaction hash. Consider using send_tx instead.\n';
    expect(extractDocsMarker(page)).toEqual({
      method: 'broadcast_tx_async',
      replacement: 'send_tx',
      line: '[Deprecated] Sends a transaction and immediately returns transaction hash. Consider using send_tx instead.',
    });
  });

  it('reads "Consider X instead" without "using"', () => {
    expect(extractDocsMarker('/openapi.json post /EXPERIMENTAL_genesis_config\n[Deprecated] Get initial state and parameters for the genesis block. Consider genesis_config instead.')?.replacement)
      .toBe('genesis_config');
  });

  it('does not mark a method for a deprecated parameter further down its page', () => {
    expect(extractDocsMarker('/openapi.json post /query\nQueries the state.\n\n## Params\n[Deprecated] `finality: optimistic` alias.')).toBeNull();
  });

  it('returns null for a live method and keeps a marker without a successor', () => {
    expect(extractDocsMarker('/openapi.json post /block\nReturns block details for given height or hash')).toBeNull();
    expect(extractDocsMarker('/openapi.json post /EXPERIMENTAL_maintenance_windows\n[Deprecated] Returns the future windows for maintenance.')?.replacement).toBeNull();
  });
});
