/**
 * The NEAR partners an agent is most often asked to build on, each with the
 * accounts, repositories and documentation feeds it publishes. Every value
 * below was checked on 2026-11-01: each contract account answered
 * view_account on mainnet, each GitHub owner answered the API, each docs
 * feed answered 200.
 *
 * `docs_feed` is set where the partner ships a Mintlify llms-full.txt (a
 * `# Title` / `Source: <url>` header per page), which sync-partner-docs
 * reads into doc_pages, or, with `single`, one llms.txt that is the whole
 * reference (the Intents Agent API, 28 KB on 2026-11-02), read as one page.
 * OutLayer ships one 300 KB document without page sources, Rhea's GitBook
 * feed is paginated without page sources, and HOT ships an index only:
 * those are linked, not ingested.
 */

export interface PartnerContract { account: string; role: string }

export interface Partner {
  id: string;
  name: string;
  summary: string;
  website: string;
  docs: string;
  llms_txt: string | null;
  docs_feed: { url: string; origin: string; single?: boolean } | null;
  github: string[];
  contracts: PartnerContract[];
  /** NEAR Catalog slugs, the first one the partner's own entry. */
  catalog_slugs: string[];
}

export const PARTNERS: readonly Partner[] = [
  {
    id: 'near-intents',
    name: 'NEAR Intents',
    summary: 'Chain-abstracted swaps and transfers: a user signs an intent, solvers compete to fill it, and the Verifier contract settles it. 1Click is the API over it.',
    website: 'https://near.com/intents',
    docs: 'https://docs.near-intents.org',
    llms_txt: 'https://docs.near-intents.org/llms.txt',
    docs_feed: { url: 'https://docs.near-intents.org/llms-full.txt', origin: 'https://docs.near-intents.org' },
    github: ['near/intents', 'defuse-protocol'],
    contracts: [{ account: 'intents.near', role: 'Verifier: holds balances and settles signed intents' }],
    catalog_slugs: ['near-intents'],
  },
  {
    id: 'intents-agent-api',
    name: 'NEAR Intents Agent API',
    summary: 'Agent Connect: gives an AI agent its own NEAR Intents account that swaps, transfers and withdraws only within a policy its owner signs once with their wallet. Plain JSON over HTTPS, called from the partner backend.',
    website: 'https://nearbuilders.org/build#agent-connect',
    docs: 'https://api.agentsonintents.com/llms.txt',
    llms_txt: 'https://api.agentsonintents.com/llms.txt',
    docs_feed: { url: 'https://api.agentsonintents.com/llms.txt', origin: 'https://api.agentsonintents.com', single: true },
    github: ['NEAR-Intents-Agent-API'],
    contracts: [{ account: 'intents.near', role: 'NEAR Intents Verifier that holds the agent accounts\' balances' }],
    catalog_slugs: [],
  },
  {
    id: 'near-ai-cloud',
    name: 'NEAR AI Cloud',
    summary: 'Private, verifiable inference: OpenAI-compatible chat, embeddings and rerank served from models running in TEEs, each response signed and checkable against the hardware attestation. NEARpedia runs /ask, its embeddings and its reranker on it.',
    website: 'https://cloud.near.ai',
    docs: 'https://docs.near.ai',
    llms_txt: 'https://docs.near.ai/llms.txt',
    docs_feed: { url: 'https://docs.near.ai/llms-full.txt', origin: 'https://docs.near.ai' },
    github: ['nearai'],
    contracts: [],
    catalog_slugs: [],
  },
  {
    id: 'outlayer',
    name: 'NEAR OutLayer',
    summary: 'Verifiable off-chain compute and TEE-held custody for agents: a contract requests execution, a TEE worker runs it and returns an attested result.',
    website: 'https://outlayer.ai',
    docs: 'https://app.outlayer.ai/docs',
    llms_txt: 'https://app.outlayer.ai/llms.txt',
    docs_feed: null,
    github: ['out-layer'],
    contracts: [{ account: 'outlayer.near', role: 'Execution requests and results' }],
    catalog_slugs: ['near-outlayer'],
  },
  {
    id: 'trezu',
    name: 'Trezu',
    summary: 'Treasury management for teams and DAOs on NEAR: multisig treasuries built on Sputnik DAO, with payments, payroll and confidential treasuries.',
    website: 'https://trezu.org',
    docs: 'https://docs.trezu.org',
    llms_txt: 'https://docs.trezu.org/llms.txt',
    docs_feed: { url: 'https://docs.trezu.org/llms-full.txt', origin: 'https://docs.trezu.org' },
    github: ['NEAR-DevHub/trezu', 'near-daos/sputnik-dao-contract'],
    contracts: [{ account: 'sputnik-dao.near', role: 'Sputnik DAO factory each treasury is created from' }],
    catalog_slugs: ['trezu'],
  },
  {
    id: 'hot',
    name: 'HOT Labs',
    summary: 'HOT Wallet, HOT Protocol (chain signatures over MPC), HOT Bridge and NEAR Connect, the open wallet connector for NEAR apps.',
    website: 'https://hot-labs.org',
    docs: 'https://hot-labs.org',
    llms_txt: 'https://hot-labs.org/llms.txt',
    docs_feed: null,
    github: ['hot-dao'],
    contracts: [{ account: 'hot.tg', role: 'HOT token' }],
    catalog_slugs: ['hot-near-wallet-telegram', 'hex-hot-exchange', 'hot-pay-crypto-payment-for-merchants-made-easy', 'hot-craft-nft-marketplace'],
  },
  {
    id: 'rhea',
    name: 'Rhea Finance',
    summary: 'The merged Ref Finance and Burrow: DEX, lending (Rhea Lend) and liquid staking on NEAR. Its old ref-finance accounts and slug remain in use.',
    website: 'https://www.rhea.finance',
    docs: 'https://guide.rhea.finance',
    llms_txt: 'https://guide.rhea.finance/llms.txt',
    docs_feed: null,
    github: ['ref-finance'],
    contracts: [
      { account: 'v2.ref-finance.near', role: 'DEX (exchange)' },
      { account: 'contract.main.burrow.near', role: 'Lending (Rhea Lend, formerly Burrow)' },
      { account: 'token.rhealab.near', role: 'RHEA token' },
      { account: 'xtoken.rhealab.near', role: 'xRHEA (staked RHEA)' },
    ],
    catalog_slugs: ['ref-finance'],
  },
];

export function getPartner(idOrName: string): Partner | null {
  const k = idOrName.trim().toLowerCase();
  const bare = (x: string) => x.replace(/^near[\s-]+/, '');
  return PARTNERS.find((p) => p.id === k || p.name.toLowerCase() === k || p.catalog_slugs.includes(k) || p.contracts.some((c) => c.account === k))
    ?? PARTNERS.find((p) => bare(p.id) === bare(k) || bare(p.name.toLowerCase()) === bare(k))
    ?? null;
}
