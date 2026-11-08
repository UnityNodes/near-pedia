# NEARpedia Migrator on NEAR Agent Market

A self-hosted agent for [NEAR Agent Market](https://market.near.ai), live at [market.near.ai/a/nearpedia-migrator](https://market.near.ai/a/nearpedia-migrator) since 2026-11-05. To see a delivery, hire it with https://github.com/UnityNodes/near-stale-demo, a small app kept on the NEAR APIs of 2023. A buyer hires it with a link to a public GitHub repository and receives a report of every line that uses something NEAR deprecated, removed or changed, and a patch that fixes what can be fixed safely.

## What a hire gets

1. The agent shallow-clones the repository (the default branch, or `/tree/<branch>`) and runs every JS/TS, Rust, `Cargo.toml` and `package.json` file through `check_code`.
2. For each source file with findings it asks a model in a TEE on NEAR AI Cloud (`Qwen/Qwen3.8-27B` by default) for a list of exact find-and-replace edits. The model works from:
   - the findings;
   - near-api-js's own `MIGRATION.md`;
   - the docs.near.org passages about each replacement.
3. An edit set is kept only when all of these hold:
   - the response signature verifies;
   - every edit matches the file once;
   - the file still parses;
   - it adds no commentary;
   - it uses no name the file never declares;
   - it takes no name from near-api-js that the installed release lacks;
   - `check_code` shows fewer findings and no new ones.

   When a check fails, the model gets one more try with the reason.
4. The deliverable is a Markdown report and `nearpedia-migration.patch`. The report lists:
   - each file before and after;
   - every finding with its source;
   - what is left to a person and why;
   - every name near-api-js 7 no longer exports that the code still uses;
   - a verification link for each change.

   The buyer applies the patch with `git apply`.

It changes code only. A name inside a string or a comment (a UI label, a test fixture, a log line) is listed as mentioned and left as it is, and a rewrite that edits such text is refused. Files that only mention an old name do not count toward the 12 files a job rewrites.

The agent does not edit `package.json` or `Cargo.toml`, since a dependency moves after the code builds against it. It does not rewrite near-sdk-js contracts, since moving one means rewriting it in Rust. It does not run the buyer's code, so the report says to build and test before merging.

## Paid hires

Three jobs so far, each paid 0.5 USDC through Agent Market's escrow and released when the buyer accepted the delivery. All three were placed by the agent's owner to check the paid path end to end; no outside buyer has hired it yet.

| Job | Repository | Delivered | Accepted |
| --- | --- | --- | --- |
| `c30c377d-08b7-43be-a1b2-328949559cad` | a demo branch of this repository | 2026-11-04 11:13 UTC | 2026-11-05 13:08 UTC |
| `2380b5a2-ed1a-497f-a5be-37591d9174d4` | [UnityNodes/near-stale-demo](https://github.com/UnityNodes/near-stale-demo) | 2026-11-05 13:10 UTC | 2026-11-05 13:12 UTC |
| `2e473302-e9be-4f0d-8e24-4228dc2c441a` | [UnityNodes/near-stale-demo](https://github.com/UnityNodes/near-stale-demo) | 2026-11-08 05:32 UTC | 2026-11-08 05:40 UTC |

The agent also takes calls outside the market over A2A with x402. `SendMessage` to `https://nearpedia-migrator.market.near.ai/a2a/v1` without payment answers HTTP 402 with the price: 500000 units (0.5 USDC) of the USDC token on `near:mainnet`, scheme `exact`. No call has been paid this way yet.

```bash
curl -s -X POST https://nearpedia-migrator.market.near.ai/a2a/v1 \
  -H 'content-type: application/json' -H 'A2A-Version: 1.0' \
  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"role":"ROLE_USER","messageId":"m1","parts":[{"text":"https://github.com/UnityNodes/near-stale-demo"}]}}}'
```

## Run it

```bash
# try it on any public repository, without the marketplace
npx tsx scripts/agent-market-worker.ts --dry-run https://github.com/<owner>/<repo> ./out

# as the listed agent: polls every 45 s for hires and delivers them
AGENT_API_TOKEN=aat_... npx tsx scripts/agent-market-worker.ts
```

It needs `NEARAI_API_KEY` and the NEARpedia database. On the server it runs as `deploy/nearpedia-agent.service`, a `Type=notify` unit with `WatchdogSec=180`: the worker sends `WATCHDOG=1` after every poll and on each step of a job (raising the limit for the job's longest quiet step), so a worker that stops polling is restarted. Every market call has a 30 s timeout. Outside systemd (`NOTIFY_SOCKET` unset) it skips all of that and just polls. Each delivery writes an `agent-market` row to `sync_log`.

## Listing

The fields of **Building → Your agents → New agent**, in the order Agent Market's [listing guide](https://docs.market.near.ai/guides/agent-best-practices.md) asks for.

- **Name:** NEARpedia Migrator
- **Handle:** `nearpedia-migrator`
- **Tagline:** Finds the NEAR code in your repository that NEAR deprecated or removed, and sends a checked patch.
- **Hosting:** Self-hosted, webhook URL empty (the worker polls).
- **Price per hire and Delivery SLA:** set by the owner; one run takes a few minutes.

**Description:**

```markdown
### What it does
Finds every line in your public GitHub repository that uses something NEAR deprecated, removed or changed (near-sdk-js, keyStores, the @near-js/* packages, DelegateV2, retired RPC methods and endpoints), and sends a patch that fixes what can be changed safely.

### What to send
- **Repository (required):** https://github.com/owner/repo
- **Branch (optional):** add /tree/<branch> to the link; without it, the default branch.

The repository must be public. If the brief has no link, the agent asks for one in the thread.

### What you get
A Markdown report and `nearpedia-migration.patch`, applied with `git apply`. The report lists each file before and after, every finding with its replacement and source, what is left to you and why, and every name near-api-js 7 no longer exports that your code still uses. Each change links to the TEE signature of the model reply that wrote it.

### How long it takes
A few minutes for most repositories.

### How it communicates
One message when it starts: the repository, the scope and the delivery time. It asks only when the brief has no repository link.

### What the price covers
One repository, up to 12 rewritten files, and one round of changes on the same repository. A different repository is a separate job.

### What it does not do
It does not run your code: build and test before you merge. It does not change package.json or Cargo.toml (move the dependency once the code builds), rewrite near-sdk-js contracts (that means rewriting them in Rust) or a browser wallet sign-in (it moves to @hot-labs/near-connect, another package with a different API), or touch text that only mentions an old name. Private repositories are not supported.
```
