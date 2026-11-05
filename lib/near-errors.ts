/**
 * The NEAR errors a developer pastes most, each with its cause and fix as
 * docs.near.org states them. Every entry carries a quote from its source
 * page; scripts/check-error-catalog.ts finds that quote in the synced copy
 * of the page on every run, so an entry whose page changed is caught rather
 * than kept answering from what the docs used to say.
 *
 * Matching is by the error's own name or exact phrase as it appears in RPC
 * and runtime output, not by topic.
 */

export interface KnownError {
  id: string;
  title: string;
  /** Recognises the error; a capture group, when present, holds the error's own words (what GitHub issues are searched for). */
  match: RegExp;
  cause: string;
  fix: string;
  source_url: string;
  /** Exact text of the source page, whitespace-normalised; checked against the synced page. */
  quote: string;
}

const RPC_TX = 'https://docs.near.org/api/rpc/transactions';
const RPC_CONTRACTS = 'https://docs.near.org/api/rpc/contracts';
const NOMICON_TRANSACTIONS = 'https://nomicon.io/RuntimeSpec/Transactions';
const NOMICON_ACTIONS = 'https://nomicon.io/RuntimeSpec/Actions';

export const KNOWN_ERRORS: readonly KnownError[] = [
  {
    id: 'prepaid-gas-exceeded',
    title: 'Exceeded the prepaid gas',
    match: /Exceeded the prepaid gas|GasExceeded/i,
    cause: 'The call ran out of the gas attached to it. One call can carry at most 300 TGas.',
    fix: 'Attach more gas (up to 300 TGas); if the work does not fit, split it across calls or cross-contract steps.',
    source_url: 'https://docs.near.org/smart-contracts/anatomy/environment',
    quote: 'if you run out of it, the execution halts with the error message `Exceeded the prepaid gas`',
  },
  {
    id: 'method-not-found',
    title: 'MethodResolveError(MethodNotFound)',
    match: /MethodNotFound|MethodResolveError/,
    cause: 'The contract on that account exports no method of that name: a typo, a method only newer code has, or the wrong account.',
    fix: 'Check the method name and the account; for a view, check the method is exported as a view in the deployed version.',
    source_url: RPC_CONTRACTS,
    quote: 'The method does not exist: `wasm execution failed with error: MethodResolveError(MethodNotFound)`',
  },
  {
    id: 'code-does-not-exist',
    title: 'CompilationError(CodeDoesNotExist)',
    match: /CodeDoesNotExist|NO_CONTRACT_CODE/,
    cause: 'The account exists but has no contract deployed.',
    fix: 'Deploy the contract to that account, or call the account that holds it.',
    source_url: RPC_CONTRACTS,
    quote: 'The account has no contract: the message starts with `wasm execution failed with error: CompilationError(CodeDoesNotExist`',
  },
  {
    id: 'unknown-account',
    title: 'UNKNOWN_ACCOUNT',
    match: /UNKNOWN_ACCOUNT|AccountDoesNotExist|does not exist while viewing/,
    cause: 'No account of that name exists on the network queried.',
    fix: 'Check the spelling, and that you query the network the account lives on (mainnet `.near` names do not exist on testnet).',
    source_url: RPC_CONTRACTS,
    quote: '| `UNKNOWN_ACCOUNT` | Account does not exist | Check account ID spelling |',
  },
  {
    id: 'garbage-collected-block',
    title: 'UNKNOWN_BLOCK / GARBAGE_COLLECTED_BLOCK',
    match: /UNKNOWN_BLOCK|GARBAGE_COLLECTED_BLOCK/,
    cause: 'The node does not have that block: a wrong hash or height, or a block older than the node keeps (regular nodes keep about 5 epochs).',
    fix: 'Use a recent block, or an archival RPC for history.',
    source_url: RPC_CONTRACTS,
    quote: '| `GARBAGE_COLLECTED_BLOCK` | Block too old | Use archival node or more recent block |',
  },
  {
    id: 'tx-expired',
    title: 'InvalidTxError: Expired',
    match: /InvalidTxError[^\n]{0,20}Expired|"Expired"/,
    cause: 'The block hash the transaction references is too old.',
    fix: 'Fetch a fresh block hash and sign again.',
    source_url: RPC_TX,
    quote: '`Expired`: the reference block hash is too old. Refresh `block_hash` and sign again.',
  },
  {
    id: 'tx-invalid-signature',
    title: 'InvalidTxError: InvalidSignature',
    match: /InvalidSignature/,
    cause: 'The signature does not match the signer\'s access key.',
    fix: 'Sign again with the key that belongs to the signer account.',
    source_url: RPC_TX,
    quote: '`InvalidSignature`: the signature does not match the signer\'s key. Sign again with the matching access key.',
  },
  {
    id: 'tx-invalid-nonce',
    title: 'InvalidTxError: InvalidNonce',
    match: /InvalidNonce/,
    cause: 'The transaction nonce is not above the access key\'s current nonce, often two transactions signed with the same key at once.',
    fix: 'Read the key\'s nonce (view_access_key), use a higher one, and sign again; send concurrent transactions from different keys.',
    source_url: RPC_TX,
    quote: 'Any other reason: fix the reported nonce, key or balance, and sign again.',
  },
  {
    id: 'shard-congested',
    title: 'ShardCongested / ShardStuck',
    match: /ShardCongested|ShardStuck/,
    cause: 'The receiver\'s shard is congested; the transaction itself may be valid.',
    fix: 'Wait, then send the same signed transaction again while its block hash is still valid.',
    source_url: RPC_TX,
    quote: '`ShardCongested` or `ShardStuck`: the receiver\'s shard is congested.',
  },
  {
    id: 'rpc-timeout',
    title: 'TIMEOUT_ERROR',
    match: /TIMEOUT_ERROR/,
    cause: 'The transaction did not reach the requested wait_until level before the RPC\'s deadline (10 s by default). It may still land.',
    fix: 'Poll tx with the transaction hash; if it never appears, send the same signed transaction again rather than a new one.',
    source_url: RPC_TX,
    quote: 'A `TIMEOUT_ERROR` means that the transaction did not reach the chosen `wait_until` level before the RPC\'s deadline.',
  },
  {
    id: 'unknown-transaction',
    title: 'UNKNOWN_TRANSACTION',
    match: /UNKNOWN_TRANSACTION/,
    cause: 'The node has no record of that transaction hash.',
    fix: 'Check the hash and the sender_account_id sent with it.',
    source_url: RPC_TX,
    quote: 'No record of the requested transaction hash.',
  },
  {
    id: 'not-enough-allowance',
    title: 'NotEnoughAllowance',
    match: /NotEnoughAllowance/,
    cause: 'The function-call access key that signed has used up its gas allowance.',
    fix: 'Add a new function-call key with an allowance (or none, for unlimited), or sign with another key.',
    source_url: 'https://docs.near.org/protocol/accounts-contracts/access-keys',
    quote: 'every transaction signed with the key fails with `NotEnoughAllowance`',
  },
  {
    id: 'too-large-contract-state',
    title: 'TOO_LARGE_CONTRACT_STATE',
    match: /TOO_LARGE_CONTRACT_STATE|too large to be viewed/,
    cause: 'view_state refuses an account whose state is above 50,000 bytes, whatever the prefix.',
    fix: 'Paginate the state, or read it through the contract\'s own view methods.',
    source_url: RPC_CONTRACTS,
    quote: 'By default, a node rejects a `view_state` request with `TOO_LARGE_CONTRACT_STATE` if the account\'s state is above 50,000 bytes.',
  },
  {
    id: 'requires-one-yocto',
    title: 'Requires attached deposit of exactly 1 yoctoNEAR',
    match: /Requires attached deposit of exactly 1 yoctoNEAR|exactly 1 yocto/i,
    cause: 'Token transfers (ft_transfer, nft_transfer and similar) demand exactly 1 yoctoNEAR attached, which only a full-access key can attach: a guard against function-call keys moving tokens.',
    fix: 'Attach a deposit of 1 yoctoNEAR to the call, signed with a full-access key.',
    source_url: 'https://docs.near.org/primitives/ft/ft',
    quote: 'assert_eq!(env::attached_deposit(), 1, "Requires attached deposit of exactly 1 yoctoNEAR");',
  },
  {
    id: 'ft-not-enough-balance',
    title: 'Smart contract panicked: The account doesn\'t have enough balance',
    match: /doesn't have enough balance|does not have enough balance/,
    cause: 'The sender holds fewer of the token than the transfer asks for (the FT contract\'s balance, not NEAR).',
    fix: 'Check ft_balance_of for the sender and send no more than it returns, in the token\'s smallest unit.',
    source_url: 'https://docs.near.org/integrations/fungible-tokens',
    quote: '"ExecutionError": "Smart contract panicked: The account doesn\'t have enough balance"',
  },
  {
    id: 'ft-not-registered',
    title: 'The account is not registered',
    match: /is not registered/,
    cause: 'The receiver has no storage registered on the FT contract, so it cannot hold the token yet.',
    fix: 'Call storage_deposit for the receiver on the token contract (storage_balance_bounds gives the amount), then transfer.',
    source_url: 'https://docs.near.org/primitives/ft/standard',
    quote: 'Returns the storage balance of a given account, or `null` if the account is not registered',
  },
  {
    id: 'not-enough-balance',
    title: 'InvalidTxError NotEnoughBalance',
    match: /\bNotEnoughBalance\b(?!ForDeposit)/,
    cause: 'The signer account does not hold enough NEAR to pay for the transaction: its gas plus the deposits it attaches.',
    fix: 'Top up the signer account, or attach a smaller deposit or less gas; the error carries the balance and the cost it needed.',
    source_url: NOMICON_TRANSACTIONS,
    quote: '/// Account does not have enough balance to cover TX cost NotEnoughBalance {',
  },
  {
    id: 'lack-balance-for-state',
    title: 'LackBalanceForState',
    match: /LackBalanceForState/,
    cause: 'After the transaction the account would not hold enough NEAR to pay for the storage it uses (storage staking): every byte an account stores locks part of its balance.',
    fix: 'Send NEAR to the account, or free storage (delete state, remove keys) before the call that adds it.',
    source_url: NOMICON_ACTIONS,
    quote: '`LackBalanceForState` if the account balance is less than this cost, or if the balance left after paying it does not cover the account\'s storage staking.',
  },
  {
    id: 'tx-status-method-not-found',
    title: 'Method not found for tx_status',
    match: /^(?=[\s\S]*\btx_status\b)[\s\S]*?(METHOD_NOT_FOUND|Method not found|-32601)/i,
    cause: 'The RPC node runs a nearcore older than 2.14.0, which only knows this method as EXPERIMENTAL_tx_status (or the method name is misspelled).',
    fix: 'Call EXPERIMENTAL_tx_status, a deprecated alias that 2.14.0 still answers, until every node you use runs 2.14.0; the status method gives a node\'s version.',
    source_url: 'https://docs.near.org/api/rpc/transactions',
    quote: 'Earlier versions call this method `EXPERIMENTAL_tx_status`. Nodes that run them return a "Method not found" error for `tx_status`.',
  },
];

export const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();

export function matchErrors(text: string): KnownError[] {
  return KNOWN_ERRORS.filter((e) => e.match.test(text));
}
