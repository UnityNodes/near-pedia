# NEAR-pedia

Live NEAR knowledge for AI agents. NEAR-pedia is an MCP server and REST API that tells a coding agent when the NEAR code it is about to write is already stale, and gives the replacement, with a source and a date on every answer.

> Status: built for the NEAR Hackathon (1–14 November 2026, tracks `open` and `agents`). Everything in [What is done](#what-is-done) runs locally and is tested; what has not been run against a live service yet says so in its row. Not yet deployed: the domain and the NEAR accounts are pending.

## The problem

Agents write NEAR code from what they remember, and NEAR keeps moving. A few changes from the weeks before this hackathon that a model trained earlier cannot know about:

- [`near-sdk-js`](https://github.com/near/near-sdk-js) is archived and its README says "DO NOT USE".
- [nearcore 2.14.0](https://github.com/near/nearcore/releases/tag/2.14.0) removes `DelegateV2`.
- NEAR Lake is shut down and its tutorials are gone from docs.near.org.
- `@near-js/*` packages stopped at 2.5.1; the maintained package is `near-api-js` 7.x.

Package registries rarely flag any of this, so the agent finds out when the build or the transaction fails. The official [`near/agent-skills`](https://github.com/near/agent-skills) are static instructions, and [`nearai/near-mcp`](https://github.com/nearai/near-mcp) performs chain actions rather than answering what is current.

## What it does

- `check_code` takes one JS/TS or Rust file, `Cargo.toml` or `package.json` and reports the lines that use something NEAR removed, deprecated or changed, and dependencies that are yanked or whole breaking lines behind, each with its replacement, the evidence and the date.
- A deprecation engine fed by six signals: archived repositories, "deprecated / do not use" in a README, npm and crates.io deprecation or yank flags, removals in release notes, the docs' own deprecation markers and deleted pages, and long-dormant packages with a live successor. Weak signals are reported as "possibly deprecated".
- A radar of what is changing now: protocol upgrades and the validator vote read from RPC, House of Stake votes, incidents, deadlines. Every alert ends when its subject resolves.
- 21 MCP tools, 12 for code and 9 for the ecosystem, the same data over REST, and a small site: `/deprecations`, `/radar`, `/protocol`, `/ask`.
- `/ask` answers through a TEE model on NEAR AI Cloud with a verifiable signature, and a hash of the database is recorded on NEAR once a day.

## What is done

| Part | State |
|---|---|
| Engine: SQLite store with FTS5 and `sqlite-vec` search, MCP server, REST API, web UI, cron sync runner, standing checks | inherited from the baseline (see below), rebranded |
| NEAR sources | syncs written and run locally against the live sources: docs.near.org (198 pages), npm and crates.io (88 packages with every version, deprecation and yank flags), GitHub (804 repositories in 8 NEAR orgs, archived state and README deprecation notices), releases of 10 products from nearcore to near-api-js. Every change they see is logged and served by `get_recent_changes` |
| Deprecation engine and seed entries | built and run locally: 134 entries on 2026-11-01, 118 from five automatic signals (archived repos, README notices, registry flags, release-note removals, the docs RPC reference's `[Deprecated]` marker) plus a weak dormancy signal, and 16 curated entries whose quotes are re-checked against the synced sources on every build. Served by the `check_deprecation` MCP tool and `/api/v1/deprecations` |
| `check_code` | built: one JS/TS, Rust, Cargo.toml, package.json or JSON file in, the lines that import, depend on, call or configure something stale out, plus yanked pins and dependencies whole breaking lines behind. MCP tool and `POST /api/v1/check-code` |
| RPC protocol state | built: mainnet and testnet protocol version, nearcore version, epoch progress, the stake-weighted upgrade vote of the block producers, the threshold from RPC and the voting schedule from the nearcore release notes, every 15 minutes. `get_protocol_status` and `/api/v1/protocol`; protocol-gated deprecations (DelegateV2, the gas rebate) say whether they are live on each network |
| House of Stake and forum | built: every vote.dao proposal with its votes and the contract's own quorum and approval arithmetic, veNEAR totals, and the gov.near.org thread each is discussed in; the governance, staking and developer listings of gov.near.org over Discourse JSON. `list_proposals`, `get_proposal`, `/api/v1/proposals` |
| Ecosystem, incidents, partners | built: the 340 projects of NEAR Catalog with tokens and TVL on NEAR from DefiLlama (Rhea Finance $270M across Rhea Lend, RHEA LST and Rhea Dex), the security incidents of NEAR protocols from DefiLlama's hacks (Rhea Lend $18.4M, NEAR Intents $3.8M, Sweat $3.5M) and of catalog projects hacked elsewhere, and a registry of five partners (NEAR Intents, OutLayer, Trezu, HOT, Rhea) with their mainnet contracts, GitHub and docs; the Intents and Trezu docs (84 pages) are searchable. `find_project`, `list_incidents`, `get_incident`, `get_partner`, `/api/v1/projects`, `/api/v1/incidents`, `/api/v1/partners` |
| Radar | built: only what is true now. Protocol upgrade 86 → 88 on mainnet (critical, due at the 4 November voting step, gone once mainnet runs 88), House of Stake votes until they close, timelocks, HSP drafts on gov.near.org until they go on chain, CODE_RED and security nearcore releases, NEAR incidents for 30 days, the hackathon deadline. Each alert carries its expiry; a resolved one is retired on the next 15-minute run, and `check-radar-expiry` fails on any live alert that is no longer true. `get_radar`, `/api/v1/radar`, `/radar`. Potlock rounds are not in: no working mainnet source on 2026-11-01 |
| `/ask` through NEAR AI Cloud | built: `/ask` and `POST /api/v1/ask` answer from this index's sources (docs, deprecation entries, the radar, `check_code` on a pasted file) through a model in a TEE on NEAR AI Cloud. `@nearai/inference-sdk` verifies the gateway's and the model's Intel TDX attestation, encrypts the request to the model's key, and checks the response signature; an answer that does not verify is not shown. Each answer carries numbered sources with dates and a receipt that opens NEAR AI's Verification Center. Needs `NEARAI_API_KEY`; not yet run against the live API (no key on the build box), the gateway attestation check was |
| MCP tool surface | built: 21 tools on the public endpoint, 12 for code (`check_code`, `check_deprecation`, `resolve_package`, `get_breaking_changes`, `explain_error`, `find_known_issues`, `get_protocol_status`, `get_doc`, `search`, `semantic_search`, `find_code_examples`, `get_standard`) and 9 for the ecosystem (`get_radar`, `list_proposals`, `get_proposal`, `list_incidents`, `get_incident`, `find_project`, `get_partner`, `get_contract_info`, `get_recent_changes`); the engine's other tools stay reachable over REST only (`lib/mcp-toolset.ts`). `explain_error` answers from 16 NEAR errors whose quotes are re-checked against docs.near.org on every sync, `get_standard` from the 59 NEPs of github.com/near/NEPs, `get_contract_info` from RPC live (methods from the wasm's export section, NEP-330 source metadata, token metadata), and every `find_code_examples` result has been through `check_code` |
| Distribution | prepared, nothing published: `server.json` for the MCP Registry, a Claude Code plugin marketplace (`.claude-plugin/`, `plugin/` with the server and a `near-current` skill), `public/llms.txt`, and the IronClaw registry entry; steps in `docs/distribution/README.md`. Publishing waits for the public repository and the domain |
| Site | built: the home page, navigation and footer rewritten for NEAR-pedia; `/deprecations` (search, status and kind filters, each entry with its evidence), `/protocol` (version, vote by stake against the threshold, schedule, the changes waiting on the upgrade), `/radar` (each alert with what ends it), `/ask`. Checked in a browser at desktop and phone width |
| Daily database hash on NEAR | built: `scripts/anchor-db.ts` hashes the database's content (not its file: a vacuumed copy hashes the same) and records it in `contracts/db-anchor`, a Rust contract that keeps one hash per date and refuses to change it or take one from anyone but its owner; `--verify <db>` checks any copy against the chain. Run end to end on a local nearcore 2.13.4 sandbox (protocol 86, as mainnet): record, re-run, matching copy, tampered copy, rewrite and stranger refused. `/api/v1/anchors`. Not yet deployed on mainnet: needs the team's account |

## Try it: the judge path

Node 22 is required (`better-sqlite3` is built against its ABI, see `.nvmrc`). No key is needed for anything below; a `GITHUB_TOKEN` in the environment only makes the GitHub syncs faster.

**1. Install and fill the database** (about 10 minutes; every source is read live):

```bash
npm ci
npm run db:init
npm run sync:near
```

**2. Start the MCP server and REST API** (port 3131), and leave it running:

```bash
npx tsx mcp-server.ts
```

**3. Check a file written from memory.** In another terminal:

```bash
curl -s -X POST http://127.0.0.1:3131/api/v1/check-code -H 'Content-Type: application/json' \
  -d '{"filename":"contract.ts","code":"import { near } from \"near-sdk-js\";\nconst a = { DelegateV2: signed };"}'
```

You see two findings. Line 1 imports near-sdk-js, which is archived: use near-sdk in Rust. Line 2 builds a DelegateV2 action, which nearcore 2.14.0 removed: use Delegate, signed with a regular access key. Each finding carries its sources and dates.

**4. Ask what is changing:**

```bash
curl -s http://127.0.0.1:3131/api/v1/radar | head -c 600
curl -s 'http://127.0.0.1:3131/api/v1/protocol?network=mainnet' | head -c 600
```

You see the mainnet protocol upgrade with its voting dates and the share of stake that has voted, and any open House of Stake vote with the date it closes.

**5. Explain an error and read a contract, live:**

```bash
curl -s -X POST http://127.0.0.1:3131/api/v1/explain-error -H 'Content-Type: application/json' \
  -d '{"error_text":"wasm execution failed with error: MethodResolveError(MethodNotFound)"}'
curl -s http://127.0.0.1:3131/api/v1/contracts/intents.near | head -c 600
```

**6. Give an agent the tools:**

```bash
claude mcp add --transport http nearpedia http://127.0.0.1:3131/mcp
```

Then ask Claude Code to write a NEAR contract in JavaScript with meta-transactions and to check it with the nearpedia tools: `check_code` answers as in step 3, naming near-sdk-js and DelegateV2 with their replacements.

**The site** (optional): `npm run build && npm run start` serves it on :3130; `/deprecations`, `/radar` and `/protocol` read the same database.

## What was built before the hackathon, and what during it

Hackathon rules count work from 19 October 2026; everything earlier is a baseline (Q-001, Q-002, Q-005).

**Baseline, not hackathon work.** The engine is a copy of `pedia-template`, the ecosystem-neutral engine we extracted from our earlier knowledge hubs [CCPEDIA](https://ccpedia.xyz) (Canton) and Blobpedia (Celestia). It brings the database layer, search and embeddings, the MCP and REST servers, the web UI, the sync runner and the standing checks. The repository's first commit is that copy, tagged [`pre-hackathon`](https://github.com/UnityNodes/nearpedia/tree/pre-hackathon).

**Hackathon work.** Everything after that tag: the NEAR rebrand, the NEAR sources, the deprecation engine, `check_code`, the RPC and House of Stake readers, the ecosystem, incident and partner data, the radar, the 21-tool MCP surface, the site pages, the NEAR AI Cloud integration, the database hash contract and the distribution files. The full difference is one link (Q-003): [`pre-hackathon...main`](https://github.com/UnityNodes/nearpedia/compare/pre-hackathon...main).

**Code from our other projects.** `lib/retry.ts` and `lib/polite-fetch.ts` are ported from Monpedia, our Monad knowledge hub (October 2026); the port added conditional requests.

**Third-party code.** Open-source libraries listed in `package.json` (Next.js, React, better-sqlite3, sqlite-vec, the MCP SDK, Express, zod, `@nearai/inference-sdk`, `near-api-js` and others) and `contracts/db-anchor/Cargo.toml` (`near-sdk`), each under its own license. Two Lottie animations are credited in `public/animations/CREDITS.txt`.

**AI assistance.** The code in this repository, the baseline included, was written with Claude Code.

## Layout

```
app/            Next.js pages and route handlers
components/     UI components
lib/            database client, search, ranking, embeddings, parsers, shared helpers
scripts/        sync-*.ts (one per source), check-*.ts, backfills, anchor-db.ts
mcp-server.ts   MCP server and REST API v1
contracts/      db-anchor, the Rust contract that records the daily database hash
plugin/         Claude Code plugin: the MCP server and the near-current skill
deploy/         systemd units, Caddyfile, sync-tick.sh, git hooks
docs/           architecture and operations notes
tests/          Vitest
```

[`docs/architecture/`](docs/architecture/README.md) explains how the engine works and the landmines already found in it.

## License

[MIT](LICENSE).
