# NEAR-pedia

Live NEAR knowledge for AI agents. NEAR-pedia is an MCP server and REST API that tells a coding agent when the NEAR code it is about to write is already stale, and gives the replacement, with a source and a date on every answer.

> Status: hackathon build in progress (NEAR Hackathon, 1–14 November 2026, tracks `open` and `agents`). The engine runs; the NEAR sources, the deprecation engine and `check_code` are being built now. The table under [What is done](#what-is-done) is the honest state of the repository.

## The problem

Agents write NEAR code from what they remember, and NEAR keeps moving. A few changes from the weeks before this hackathon that a model trained earlier cannot know about:

- [`near-sdk-js`](https://github.com/near/near-sdk-js) is archived and its README says "DO NOT USE".
- [nearcore 2.14.0](https://github.com/near/nearcore/releases/tag/2.14.0) removes `DelegateV2`.
- NEAR Lake is shut down and its tutorials are gone from docs.near.org.
- `@near-js/*` packages stopped at 2.5.1; the maintained package is `near-api-js` 7.x.

Package registries rarely flag any of this, so the agent finds out when the build or the transaction fails. The official [`near/agent-skills`](https://github.com/near/agent-skills) are static instructions, and [`nearai/near-mcp`](https://github.com/nearai/near-mcp) performs chain actions rather than answering what is current.

## What it will do

- `check_code`: takes JS/TS/Rust source and reports deprecated imports, packages, methods and versions, each with its replacement, the evidence and the date.
- A deprecation engine fed by six signals: archived repositories, "deprecated / do not use" in a README, npm and crates.io deprecation or yank flags, removals in release notes, deleted or rewritten docs pages, and long-dormant packages with a live successor. Weak signals are reported as "possibly deprecated".
- A radar of what is changing now: protocol upgrades and their validator votes read from RPC, House of Stake proposals, incidents, deadlines. Every alert carries an expiry date.
- Around 20 MCP tools in total, split between code (`check_code`, `check_deprecation`, `resolve_package`, `get_breaking_changes`, `explain_error`, `get_protocol_status`, …) and ecosystem (`get_radar`, `list_proposals`, `find_project`, `get_contract_info`, …).

## What is done

| Part | State |
|---|---|
| Engine: SQLite store with FTS5 and `sqlite-vec` search, MCP server, REST API, web UI, cron sync runner, standing checks | inherited from the baseline (see below), rebranded |
| NEAR sources | syncs written and run locally against the live sources: docs.near.org (198 pages), npm and crates.io (88 packages with every version, deprecation and yank flags), GitHub (804 repositories in 8 NEAR orgs, archived state and README deprecation notices), releases of 10 products from nearcore to near-api-js. Every change they see is logged. Not yet exposed as MCP tools |
| Deprecation engine and seed entries | built and run locally: 133 entries from five automatic signals (archived repos, README notices, registry flags, release-note removals, the docs RPC reference's `[Deprecated]` marker) plus a weak dormancy signal, and 15 curated entries whose quotes are re-checked against the synced sources on every build. Served by the `check_deprecation` MCP tool and `/api/v1/deprecations` |
| `check_code` | not started |
| RPC protocol state, House of Stake, radar | not started |
| `/ask` through NEAR AI Cloud, daily database hash written to NEAR | not started |

## Try it locally

Node 22 is required (`better-sqlite3` is built against its ABI, see `.nvmrc`).

```bash
npm install
cp .env.example .env.production      # fill in keys; never commit it
npm run db:init                      # creates data/cips.db
npm run build && npm run start       # web UI on :3130
npx tsx mcp-server.ts                # MCP + REST on :3131
```

Then `curl http://127.0.0.1:3131/api/v1` lists the REST routes, and `claude mcp add --transport http nearpedia http://127.0.0.1:3131/mcp` connects Claude Code to the local server. Until the NEAR syncs land the database is empty, so the tools return no results.

## What was built before the hackathon, and what during it

Hackathon rules count work from 19 October 2026; everything earlier is a baseline (Q-001, Q-002, Q-005).

**Baseline, not hackathon work.** The engine is a copy of `pedia-template`, the ecosystem-neutral engine we extracted from our earlier knowledge hubs [CCPEDIA](https://ccpedia.xyz) (Canton) and Blobpedia (Celestia). It brings the database layer, search and embeddings, the MCP and REST servers, the web UI, the sync runner and the standing checks. The repository's first commit is that copy, tagged [`pre-hackathon`](https://github.com/UnityNodes/nearpedia/tree/pre-hackathon).

**Hackathon work.** Everything after that tag: the NEAR rebrand, the NEAR sources, the deprecation engine, `check_code`, the RPC and House of Stake readers, the NEAR AI Cloud integration and the on-chain database hash. The full difference is one link (Q-003): [`pre-hackathon...main`](https://github.com/UnityNodes/nearpedia/compare/pre-hackathon...main).

**Code from our other projects.** `lib/retry.ts` and `lib/polite-fetch.ts` are ported from Monpedia, our Monad knowledge hub (October 2026); the port added conditional requests.

**Third-party code.** Open-source libraries listed in `package.json` (Next.js, React, better-sqlite3, sqlite-vec, the MCP SDK, Express, zod and others), each under its own license. Two Lottie animations are credited in `public/animations/CREDITS.txt`.

**AI assistance.** The code in this repository, the baseline included, was written with Claude Code.

## Layout

```
app/            Next.js pages and route handlers
components/     UI components
lib/            database client, search, ranking, embeddings, parsers, shared helpers
scripts/        sync-*.ts (one per source), check-*.ts, backfills
mcp-server.ts   MCP server and REST API v1
deploy/         systemd units, Caddyfile, sync-tick.sh, git hooks
docs/           architecture and operations notes
tests/          Vitest
```

[`docs/architecture/`](docs/architecture/README.md) explains how the engine works and the landmines already found in it.

## License

[MIT](LICENSE).
