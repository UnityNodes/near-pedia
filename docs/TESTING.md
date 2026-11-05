# Tests

```bash
npm test                 # 935 tests in 86 files, about 5 seconds, no network and no keys
npx tsc --noEmit         # the app
npm run typecheck:scripts
npm run lint
```

CI runs all four on every push to `main` and every pull request (`.github/workflows/ci.yml`).

## How the suite is kept honest

- **No network, no credentials.** `tests/setup.ts` blocks outbound requests and clears keys from the environment unless a test asks for them explicitly, so a test run cannot post to a real channel or write to the production database.
- **Real upstream data.** The parsers are tested on snapshots of what NEAR's sources actually served: docs.near.org's `llms-full.txt`, npm and crates.io documents, GitHub org listings and READMEs, vote.dao proposals, gov.near.org listings, DefiLlama hacks and the Nomicon. They live in `tests/fixtures/` or inline with the date they were taken. A test named "(2026-11-01)" checks against that day's real response.
- **In-memory databases.** Database tests open `:memory:` SQLite with the real schema (`DB_PATH=:memory:` in `vitest.config.ts`).

## What each part checks

### Is this NEAR code current? (`check_code` and the deprecation engine)

| File | What it checks |
| --- | --- |
| `lib/check-code.test.ts` | The demo file a model writes from memory (near-sdk-js, `DelegateV2`) gets exactly the findings it should, on the right lines. RPC method names, manifests, yanked pins and dependencies whole breaking lines behind are flagged. A name in a comment is not |
| `lib/code-scan.test.ts` | Language detection, and which imports, identifiers and RPC calls are read from JS/TS and Rust |
| `lib/deprecation-engine.test.ts` | Each of the six signals is collected; entries from several signals merge into one; curated quotes are re-checked against the synced sources; a build writes and retires entries |
| `lib/deprecation-extract.test.ts` | What release notes say was removed, read from real nearcore, near-api-js and near-sdk notes. Context words around the change are skipped, and "remove feature gates" is not read as removing the feature |
| `lib/deprecations.test.ts` | Lookup by name, alias and package, as `check_deprecation` and `/api/v1/deprecations` answer it |
| `lib/code-tools.test.ts` | `resolve_package`, `get_breaking_changes` (breaking lines in changelogs) and `explain_error` |
| `lib/registry-packages.test.ts`, `lib/packages-store.test.ts` | npm and crates.io documents become versions, deprecation and yank flags |
| `lib/github-repos.test.ts` | Archived repositories and "deprecated / do not use" README notices, on real NEAR READMEs |
| `lib/releases.test.ts`, `lib/release-text.test.ts` | Release versions and notes |
| `github-action/lib.test.ts` | The pull-request check: which files it reads, which lines a pull request adds, the comment it writes (added lines first, replacement and source per row), escaped annotations, no accidental @-mentions, and `fail-on` |

### What is NEAR doing now? (protocol, governance, radar, ecosystem)

| File | What it checks |
| --- | --- |
| `lib/protocol.test.ts` | The upgrade schedule from nearcore release notes, the stake-weighted vote, the threshold, and the version that passes |
| `lib/validators.test.ts` | Validator ranking by stake, share, work done, kickout reasons |
| `lib/house-of-stake.test.ts`, `lib/hos-read.test.ts` | vote.dao proposals, veNEAR, and the contract's own quorum and approval arithmetic |
| `lib/gov-forum.test.ts`, `lib/forum.test.ts`, `lib/forum-topic-ref.test.ts` | gov.near.org listings and topics, HSP matching, thread references |
| `lib/near-radar.test.ts` | Radar items for upgrades, node releases, proposals and incidents, each with what ends it |
| `lib/near-catalog.test.ts`, `lib/ecosystem-find.test.ts`, `lib/incidents.test.ts` | NEAR Catalog projects, TVL, project search, DefiLlama hacks |

### Answers (`/ask`, search, embeddings)

| File | What it checks |
| --- | --- |
| `lib/ask.test.ts` | What `/ask` sends the model: numbered sources with URL and date, upstream text and pasted code fenced as data, proposals named by HSP number, follow-ups that find their topic through earlier questions, history quoted as data and never as assistant messages |
| `lib/near-ai.test.ts` | An answer is shown only when its signature is from the model's TEE; the receipt links NEAR AI's Verification Center; one retry after a dropped connection, none after a 4xx |
| `app/ask-citations.test.ts`, `app/ask-conversations.test.ts` | Citation links that leave code alone, the copied answer with its sources, saved conversations and their migration |
| `lib/embeddings.test.ts`, `lib/vector-store.test.ts`, `lib/reranker.test.ts` | Chunking, content-hash invalidation, vector writes, reranking |
| `lib/fts-prefix-match.test.ts`, `lib/search-*.test.ts` | Full-text search with hostile and punctuated queries |

### Sources, server and operations

| File | What it checks |
| --- | --- |
| `lib/near-docs.test.ts`, `lib/site-docs.test.ts`, `lib/docs*.test.ts`, `lib/doc-trust.test.ts` | docs.near.org's feed, page diffs, which docs are first-party |
| `lib/near-blogs.test.ts`, `lib/blog*.test.ts`, `lib/video*.test.ts`, `lib/youtube-next.test.ts` | Blog posts without site chrome, video descriptions and transcripts |
| `lib/polite-fetch.test.ts`, `lib/github-pages.test.ts` | Rate limits, conditional requests, GitHub pagination |
| `lib/db-hash.test.ts` | The daily database hash covers content, not insertion order or operational tables; one changed value changes it; a recorded anchor cannot be changed |
| `lib/failure-alerts.test.ts`, `lib/ops-pager.test.ts`, `lib/schedule-backups.test.ts`, `lib/log-retention.test.ts` | When a failing or late source becomes an alert; backups and the restore drill have deadlines |
| `lib/sanitize.test.ts`, `lib/safe-token.test.ts`, `lib/csp-*.test.ts`, `api/*.test.ts`, `lib/rate-limit.test.ts` | HTML sanitising, constant-time token checks, the CSP report endpoint, the contact form, rate-limit identity |
| `lib/mcp-accept.test.ts`, `lib/mcp-negotiation.test.ts`, `lib/for-ai-tool-groups.test.ts` | MCP transport negotiation and the public tool set |
| the rest | Small helpers: dates, ids, JSON-LD, user-agent classes |

## Beyond the unit tests

- **`scripts/check-*.ts`** (dozens, in the daily bucket) check the live database against its sources, for example counts against upstream totals, radar alerts that are no longer true, fencing and citations. Each writes its outcome to `sync_log`.
- **`scripts/post-deploy-check.sh`** hits every page, API, feed and security header of a deployed site.
- **`scripts/backup-restore-drill.sh`** restores the newest local and Drive backups every week and compares them with the live database.
