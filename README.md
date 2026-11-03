<p align="center">
  <img src="assets/banner.svg" alt="NEARpedia. What NEAR looks like today. A terminal session: an agent adds the NEARpedia MCP server (27 tools), check_code names near-sdk-js, DelegateV2 and keyStores in its file with their replacements, get_validators and get_proposal answer live." width="100%">
</p>

<p align="center">
  <a href="#connect-an-agent"><img alt="Connect an agent" src="https://img.shields.io/badge/CONNECT_AN_AGENT-00EC97?style=for-the-badge&logo=modelcontextprotocol&logoColor=0B0B0C"></a>
  <a href="https://near-pedia.xyz"><img alt="Live site near-pedia.xyz" src="https://img.shields.io/badge/LIVE-near--pedia.xyz-21262D?style=for-the-badge&labelColor=008F5D"></a>
  <a href="https://near-pedia.xyz/ask"><img alt="Ask a question" src="https://img.shields.io/badge/ASK-a_question-21262D?style=for-the-badge&labelColor=008F5D"></a>
  <a href="https://near-pedia.xyz/for-ai"><img alt="MCP setup for every client" src="https://img.shields.io/badge/MCP-every_client-21262D?style=for-the-badge&labelColor=008F5D"></a>
</p>

<p align="center">
  <a href="https://github.com/UnityNodes/near-pedia/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/UnityNodes/near-pedia/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-008F5D"></a>
  <img alt="Node 22" src="https://img.shields.io/badge/node-22-008F5D?logo=nodedotjs&logoColor=white">
  <img alt="MCP over Streamable HTTP" src="https://img.shields.io/badge/MCP-Streamable_HTTP-008F5D">
  <img alt="NEAR mainnet" src="https://img.shields.io/badge/network-NEAR_mainnet-008F5D">
</p>

Live NEAR knowledge for AI agents. NEARpedia is an MCP server and REST API that tells a coding agent when the NEAR code it is about to write is already stale, and gives the replacement, with a source and a date on every answer. The same index serves people researching NEAR: a site and an `/ask` chat about protocol upgrades, House of Stake votes, validators, projects and incidents.

Built for the NEAR Hackathon (1–14 November 2026, tracks `open` and `agents`). Live at [near-pedia.xyz](https://near-pedia.xyz) since 2 November 2026; the MCP endpoint `https://near-pedia.xyz/mcp` needs no key.

> [!TIP]
> Agents write NEAR code from what they remember, and NEAR keeps moving. A few changes from the weeks before this hackathon that a model trained earlier cannot know about:
>
> - [`near-sdk-js`](https://github.com/near/near-sdk-js) is archived and its README says "DO NOT USE".
> - [nearcore 2.14.0](https://github.com/near/nearcore/releases/tag/2.14.0) removes `DelegateV2`.
> - NEAR Lake is shut down and its tutorials are gone from docs.near.org.
> - `@near-js/*` packages stopped at 2.5.1; the maintained package is `near-api-js` 7.x, which ships no `keyStores`.
>
> Package registries rarely flag any of this, so the agent finds out when the build or the transaction fails. The official [`near/agent-skills`](https://github.com/near/agent-skills) are static instructions, and [`nearai/near-mcp`](https://github.com/nearai/near-mcp) performs chain actions rather than answering what is current.

## How it works

<p align="center">
  <img src="assets/flow.svg" alt="Four steps. 1, Read: NEAR's own sources, live (docs, GitHub, npm and crates, RPC, House of Stake, the forum, blogs, videos, NEAR Catalog). 2, Index: full-text and meaning search over every source, what NEAR deprecated with the evidence, a radar whose alerts expire. 3, Check: check_code names each line that uses something NEAR removed, with what replaces it. 4, Answer: 27 MCP tools, a REST API, a site and /ask on NEAR AI, each answer with its source and its date." width="100%">
</p>

The deprecation engine is fed by six signals: archived repositories, "deprecated / do not use" in a README, npm and crates.io deprecation or yank flags, removals in release notes, the docs' own deprecation markers and deleted pages, and long-dormant packages with a live successor. Weak signals are reported as "possibly deprecated". The radar keeps only what is true now: every alert ends when its subject resolves.

## Three ways in

<p align="center">
  <img src="assets/card-developers.svg" alt="For developers: is my NEAR code current? 12 tools: check_code, check_deprecation, resolve_package, get_breaking_changes, explain_error, find_known_issues, find_code_examples, get_standard, get_protocol_status, search, semantic_search, get_doc." width="32%">
  <img src="assets/card-builders.svg" alt="For builders: what is moving on NEAR? 10 tools: get_radar, list_proposals, get_proposal, get_discussion, list_incidents, get_incident, find_project, get_partner, get_contract_info, get_recent_changes." width="32%">
  <img src="assets/card-everyone.svg" alt="For everyone: what is NEAR right now? 5 tools: get_network_state, get_validators, list_blog_posts, get_blog_post, list_videos." width="32%">
</p>

| You want to | Go to |
| --- | --- |
| Give your coding agent the tools | [Connect an agent](#connect-an-agent), or [/for-ai](https://near-pedia.xyz/for-ai) for Claude Desktop, VS Code, Windsurf, Cline and Continue |
| See what NEAR deprecated, with the evidence | [/deprecations](https://near-pedia.xyz/deprecations) |
| Follow the protocol upgrade and the validator vote | [/protocol](https://near-pedia.xyz/protocol), [/radar](https://near-pedia.xyz/radar) |
| Read House of Stake proposals and how the vote stands | [/governance](https://near-pedia.xyz/governance) |
| Ask in plain words | [/ask](https://near-pedia.xyz/ask), answered by a model in a TEE on NEAR AI Cloud |

## Connect an agent

```bash
claude mcp add --transport http nearpedia https://near-pedia.xyz/mcp
```

Then ask Claude Code to write a NEAR contract in JavaScript with meta-transactions and to check it with the nearpedia tools: `check_code` names near-sdk-js and `DelegateV2` with their replacements.

<details>
<summary><strong>Codex, Cursor and other clients</strong></summary>

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.nearpedia]
url = "https://near-pedia.xyz/mcp"
```

Cursor, in `~/.cursor/mcp.json` or `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nearpedia": { "url": "https://near-pedia.xyz/mcp" }
  }
}
```

Claude Desktop, VS Code, Windsurf, Cline and Continue each name the fields differently; [near-pedia.xyz/for-ai](https://near-pedia.xyz/for-ai) has the exact block for each. The public endpoint allows 300 tool calls per 15 minutes per client.

</details>

## Check every pull request

A GitHub Action runs `check_code` on the files a pull request changes and leaves one comment: each line that uses something NEAR deprecated, removed or changed, what replaces it, and the source. Add `.github/workflows/nearpedia.yml`:

```yaml
name: NEARpedia
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: UnityNodes/near-pedia/github-action@main
```

No key is needed. On 3 November 2026, [near-examples/coin-flip-examples#37](https://github.com/near-examples/coin-flip-examples/pull/37) added 7 such lines: the `@near-js/*` packages that near-api-js 7 replaced, and dependencies whole breaking lines behind. Inputs, outputs and a way to run it against any public pull request without installing anything are in [`github-action/README.md`](github-action/README.md).

How common this is: on 3 November 2026, 19 of the 67 NEAR Hackathon projects with a public repository used something NEAR deprecated, removed or changed, most often `keyStores` and the `@near-js/*` packages. The method, and a script that reproduces the count without naming anyone, are in [`docs/demo/hackathon-stale-count.md`](docs/demo/hackathon-stale-count.md).

## Try it against the live API

No install, no key:

```bash
# a file written from memory: three findings, each with its replacement and sources
curl -s -X POST https://near-pedia.xyz/api/v1/check-code -H 'Content-Type: application/json' \
  -d '{"filename":"contract.ts","code":"import { NearBindgen } from \"near-sdk-js\";\nconst d = { DelegateV2: signed };\nconst ks = new keyStores.InMemoryKeyStore();"}'

# the mainnet protocol version, the upgrade vote by stake and the voting schedule
curl -s 'https://near-pedia.xyz/api/v1/protocol?network=mainnet' | head -c 600

# what is changing now, each alert with what ends it
curl -s https://near-pedia.xyz/api/v1/radar | head -c 600
```

`check_code` answers: line 1 imports near-sdk-js, archived, use near-sdk in Rust; line 2 builds a `DelegateV2` action, removed in nearcore 2.14.0, use `Delegate` signed with a regular access key; line 3 uses `keyStores`, which near-api-js 7 does not ship, use a `KeyPairSigner`.

## Run it yourself

The judge path, from a clean clone:

```bash
git clone https://github.com/UnityNodes/near-pedia
cd near-pedia
npm ci
npm run db:init
npm run sync:near          # every source is read live, about 25 minutes
npx tsx mcp-server.ts      # MCP and REST on :3131, leave it running
```

In another terminal:

```bash
curl -s -X POST http://127.0.0.1:3131/api/v1/check-code -H 'Content-Type: application/json' \
  -d '{"filename":"contract.ts","code":"import { near } from \"near-sdk-js\";\nconst a = { DelegateV2: signed };"}'
curl -s 'http://127.0.0.1:3131/api/v1/protocol?network=mainnet' | head -c 600
curl -s -X POST http://127.0.0.1:3131/api/v1/explain-error -H 'Content-Type: application/json' \
  -d '{"error_text":"wasm execution failed with error: MethodResolveError(MethodNotFound)"}'
curl -s http://127.0.0.1:3131/api/v1/contracts/intents.near | head -c 600
claude mcp add --transport http nearpedia http://127.0.0.1:3131/mcp
```

You see two `check_code` findings (near-sdk-js on line 1, `DelegateV2` on line 2, each with its sources, dated where the source has a date), the mainnet upgrade with its voting dates and the share of stake that has voted, what the `MethodNotFound` error means and how to fix it, and the methods deployed on `intents.near` read live from RPC. `npm run build && npm run start` serves the site on :3130 from the same database. `npm test` runs 883 tests without network or keys; [`docs/TESTING.md`](docs/TESTING.md) says what each part checks.

**You need**

- Node 22 (`better-sqlite3` is built against its ABI, see `.nvmrc`)
- No key for the steps above. `NEARAI_API_KEY` embeds the corpus for `semantic_search` (otherwise it matches words; embedding adds about 50 minutes) and turns on `/ask`; `GITHUB_TOKEN` adds the open issues and discussions of the NEAR repositories

## What is done

| Part | State |
| --- | --- |
| Engine: SQLite with FTS5 and `sqlite-vec`, MCP server, REST API, web UI, sync runner, standing checks | inherited from the baseline (see [below](#what-was-built-before-the-hackathon-and-what-during-it)), rebranded. The baseline's features with no NEAR counterpart (improvement-proposal pages, whitepapers, digest, trending, glossary, foundation pages, analytics) were removed with their tools, endpoints, tables and tests |
| NEAR sources | built and run against the live sources: docs.near.org (198 pages), npm and crates.io (89 packages with every version, deprecation and yank flags), GitHub (808 repositories in 9 NEAR orgs, archived state and README notices), releases of 10 products from nearcore to near-api-js. Every change they see is logged and served by `get_recent_changes` |
| Corpus and semantic search | built on 2026-11-02: 17,867 chunks from docs, the forum, blogs, videos, release notes, the catalog and GitHub, embedded with Qwen3-Embedding and reranked with Qwen3-Reranker on NEAR AI Cloud (about $0.07 for the whole index). `scripts/check-completeness.ts` matched all 37 source counts against the upstream totals; the breakdown is under "What the corpus holds" below |
| Deprecation engine | built: 137 entries on 2026-11-02, 118 from five automatic signals plus a weak dormancy signal, and 19 curated entries whose quotes are re-checked against the synced sources on every build, among them what near-api-js 7 removed or renamed from the v4 API agents remember (key stores, `WalletConnection`, `actionCreators`). `check_deprecation`, `/api/v1/deprecations` |
| `check_code` | built: one JS/TS, Rust, `Cargo.toml`, `package.json` or JSON file in; the lines that import, depend on, call or configure something stale out, plus yanked pins and dependencies whole breaking lines behind. MCP tool and `POST /api/v1/check-code` |
| GitHub Action | built: `github-action/` reads a pull request's changed files, runs them through `check_code`, and posts or updates one comment that puts the lines the pull request adds first, with replacement and source; annotations on those lines, an optional `fail-on` gate, and a job-summary fallback on forks. Run against a real pull request on 2026-11-03 (7 findings in near-examples/coin-flip-examples#37) |
| RPC protocol state and validators | built: mainnet and testnet protocol and nearcore version, epoch progress, the stake-weighted upgrade vote against the threshold from RPC, and the voting schedule from the nearcore release notes, every 15 minutes; protocol-gated deprecations (`DelegateV2`, the gas rebate) say whether they are live on each network. The validator set live from RPC: stake, share, work done this epoch, kickouts, a pool's fee. `get_protocol_status`, `get_validators`, `/api/v1/protocol` |
| House of Stake and forum | built: every vote.dao proposal with its votes and the contract's own quorum and approval arithmetic, veNEAR totals, and the gov.near.org thread it is discussed in; 2,834 gov.near.org topics in the governance, staking, developer, ecosystem and education categories. `list_proposals`, `get_proposal`, `get_discussion`, `/api/v1/proposals` |
| Ecosystem, incidents, partners | built: the 340 projects of NEAR Catalog with tokens and TVL on NEAR from DefiLlama, the security incidents of NEAR protocols from DefiLlama's hacks and of catalog projects hacked elsewhere, and six partners (NEAR Intents, the Intents Agent API, OutLayer, Trezu, HOT, Rhea) with their mainnet contracts, GitHub and docs. `find_project`, `list_incidents`, `get_incident`, `get_partner` |
| Radar | built: protocol upgrades, House of Stake votes until they close, timelocks, HSP drafts until they go on chain, CODE_RED and security nearcore releases, NEAR incidents for 30 days, the hackathon deadline. Each alert carries its expiry and is retired on the next 15-minute run once resolved; `check-radar-expiry` fails on any live alert that is no longer true. `get_radar`, `/api/v1/radar`. Potlock rounds are not in: no working mainnet source on 2026-11-01 |
| `/ask` on NEAR AI Cloud | built and run against the live API on 2026-11-02: a chat that answers from this index through a model in a TEE; a follow-up sees the last three exchanges, so "and did it pass?" after a question about HSP-029 answers about HSP-029. `@nearai/inference-sdk` verifies the gateway's and the model's Intel TDX attestation, encrypts the request to the model's key and checks the response signature; an answer that does not verify is not shown. Each answer carries numbered, dated sources and a receipt for NEAR AI's Verification Center. Needs `NEARAI_API_KEY` |
| MCP tool surface | built: 27 tools on the public endpoint, 12 for code, 10 for builders and 5 for everyone (the cards above). Each of the 47 handlers was called with real inputs on 2026-11-02; the 20 left out duplicate a public tool, return the baseline's template data or match loosely, and stay reachable over REST (`lib/mcp-toolset.ts`; `MCP_TOOLSET=full` serves all 47) |
| Site | built and live: a home page with two ways in, `/deprecations`, `/protocol`, `/radar`, `/governance`, `/feed`, `/ask`, and browsers for docs, forum, blog, videos, releases, projects and issues. Checked in a browser at desktop and phone width |
| Distribution | prepared, nothing published yet: `server.json` for the MCP Registry, a Claude Code plugin marketplace (`.claude-plugin/`, `plugin/` with the server and a `near-current` skill), `public/llms.txt` and the IronClaw registry entry; steps in `docs/distribution/README.md` |
| Daily database hash on NEAR | built, not yet deployed on mainnet (needs the team's account): `scripts/anchor-db.ts` hashes the database's content (a vacuumed copy hashes the same) and records it in `contracts/db-anchor`, a Rust contract that keeps one hash per date and refuses to change it or take one from anyone but its owner; `--verify <db>` checks any copy against the chain. Run end to end on a local nearcore 2.13.4 sandbox: record, re-run, matching copy, tampered copy, rewrite and stranger refused. `/api/v1/anchors` |

<details>
<summary><strong>What the corpus holds</strong></summary>

As filled on 2026-11-02:

| Source | Count |
| --- | --- |
| Documentation pages: docs.near.org, the Nomicon, NEAR AI Cloud, NEAR Intents, the Intents Agent API, Trezu | 483 |
| gov.near.org topics (posts read for the 2,289 in the governance, staking, developer, ecosystem and education categories) | 2,834 |
| near.org and near.ai blog posts | 670 |
| Videos of the NEAR Protocol, NEAR DevHub and NEAR AI channels (1,806 with a description) | 1,837 |
| Release notes | 1,328 |
| NEAR Catalog projects | 340 |
| Open issues and open pull requests of 19 NEAR repositories (with `GITHUB_TOKEN`) | 2,517 and 622 |
| GitHub Discussions of 6 repositories (with `GITHUB_TOKEN`) | 255 |
| NEP standards, for `get_standard` | 59 |
| NEAR errors with quotes re-checked against docs.near.org and the Nomicon, for `explain_error` | 19 |

Forum posts and GitHub bodies are stripped of their HTML and blog posts of the site's footer; videos are embedded once they have a description, releases only with notes. The first fill reads the posts of the 300 newest threads and 300 video descriptions; the schedule reads the rest (40 threads every 15 minutes, 300 descriptions a day).

</details>

<details>
<summary><strong>Layout</strong></summary>

```
app/            Next.js pages and route handlers
components/     UI components
lib/            database client, search, ranking, embeddings, parsers, shared helpers
scripts/        sync-*.ts (one per source), check-*.ts, backfills, anchor-db.ts
mcp-server.ts   MCP server and REST API v1
contracts/      db-anchor, the Rust contract that records the daily database hash
plugin/         Claude Code plugin: the MCP server and the near-current skill
github-action/  the pull-request check (action.yml, no dependencies)
deploy/         systemd units, Caddyfile, sync-tick.sh, git hooks
docs/           setup (cron) and distribution notes
assets/         the images in this README
tests/          Vitest
```

</details>

## What was built before the hackathon, and what during it

Hackathon rules count work from 19 October 2026; everything earlier is a baseline (Q-001, Q-002, Q-005).

**Baseline, not hackathon work.** The engine is a copy of `pedia-template`, the ecosystem-neutral engine we extracted from our earlier knowledge hubs [CCPEDIA](https://ccpedia.xyz) (Canton) and Blobpedia (Celestia). It brings the database layer, search and embeddings, the MCP and REST servers, the web UI, the sync runner and the standing checks. The repository's first commit is that copy, tagged [`pre-hackathon`](https://github.com/UnityNodes/near-pedia/tree/pre-hackathon).

**Hackathon work.** Everything after that tag: the NEAR rebrand, the NEAR sources, the deprecation engine, `check_code`, the RPC, validator and House of Stake readers, the ecosystem, incident and partner data, the radar, the 27-tool MCP surface, the GitHub Action, the site pages, the NEAR AI Cloud integration, the database hash contract and the distribution files. The full difference is one link (Q-003): [`pre-hackathon...main`](https://github.com/UnityNodes/near-pedia/compare/pre-hackathon...main).

**Code from our other projects.** `lib/retry.ts` and `lib/polite-fetch.ts` are ported from Monpedia, our Monad knowledge hub (October 2026); the port added conditional requests.

**Third-party code.** Open-source libraries listed in `package.json` (Next.js, React, better-sqlite3, sqlite-vec, the MCP SDK, Express, zod, `@nearai/inference-sdk`, `near-api-js` and others) and `contracts/db-anchor/Cargo.toml` (`near-sdk`), each under its own license. Two Lottie animations are credited in `public/animations/CREDITS.txt`. The site and the images in `assets/` use Space Grotesk and JetBrains Mono, both under the SIL Open Font License 1.1.

**AI assistance.** The code in this repository, the baseline included, was written with Claude Code.

## Not an official project

NEARpedia is an independent community project. It is not a product of the NEAR Foundation, NEAR AI or House of Stake; it reads their public sources and links back to each.

## License

[MIT](LICENSE).

Maintained by [Unity Nodes](https://github.com/UnityNodes).
