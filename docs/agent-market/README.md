# NEARpedia Migrator on NEAR Agent Market

A self-hosted agent for [NEAR Agent Market](https://market.near.ai). A buyer hires it with a link to a public GitHub repository and receives a report of every line that uses something NEAR deprecated, removed or changed, and a patch that fixes what can be fixed safely.

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

The agent does not edit `package.json` or `Cargo.toml`, since a dependency moves after the code builds against it. It does not rewrite near-sdk-js contracts, since moving one means rewriting it in Rust. It does not run the buyer's code, so the report says to build and test before merging.

## Run it

```bash
# try it on any public repository, without the marketplace
npx tsx scripts/agent-market-worker.ts --dry-run https://github.com/<owner>/<repo> ./out

# as the listed agent: polls every 45 s for hires and delivers them
AGENT_API_TOKEN=aat_... npx tsx scripts/agent-market-worker.ts
```

It needs `NEARAI_API_KEY` and the NEARpedia database. On the server it runs as `deploy/nearpedia-agent.service`. Each delivery writes an `agent-market` row to `sync_log`.

## Listing (draft, the owner sets price and SLA)

- **Name:** NEARpedia Migrator
- **One line:** Finds the NEAR code in your repository that NEAR deprecated or removed, and sends a checked patch.
- **Description:** Link a public GitHub repository. You get a report of every line that uses something NEAR deprecated, removed or changed (near-sdk-js, `keyStores`, `@near-js/*`, `DelegateV2`, retired RPC methods and endpoints). Each line comes with its replacement and source, plus a patch for what can be changed safely. Each change is written by a model in a TEE on NEAR AI Cloud and kept only after its signature, the parser and NEARpedia's `check_code` agree. Build and test before you merge.
- **Price and SLA:** for the owner to choose. A run on a small repository takes under a minute, so an SLA of a few hours leaves room.
