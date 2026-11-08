# Stale NEAR code in NEAR Hackathon projects

Measured on 8 November 2026, six days before the deadline. The first count, on 3 November, found 19 of 67 (28%) when the hackathon listed 89 projects; this one is a new, larger set, not a recheck of the same 67.

**48 of the 162 projects with a public repository use something NEAR deprecated, removed or changed (30%). Among the 100 that use NEAR's JavaScript libraries, it is 44 (44%).**

Each finding is a NEAR change that the code has not caught up with.

## What they use

| What | Projects | What replaces it |
| --- | --- | --- |
| the `@near-js/*` packages, which stopped at 2.5.1 | 24 | `near-api-js` 7.x |
| `actionCreators` (renamed to `actions` in near-api-js 7) | 23 | `actions`, with `addFullAccessKey` and `addFunctionCallKey` instead of `addKey` |
| `keyStores` from near-api-js (gone in near-api-js 7) | 19 | a `KeyPairSigner`, or a `KeyPairString` passed to `new Account()` |
| the `broadcast_tx_commit` RPC method | 6 | `send_tx` |
| near-sdk-js, archived on 30 October 2026 | 3 | Rust near-sdk |
| the `EXPERIMENTAL_genesis_config` RPC method | 2 | `genesis_config` |
| the NEAR web wallet | 1 | a wallet from near-connect |
| a Pagoda RPC endpoint or service, which refuses requests | 1 | an endpoint from the RPC providers list |
| the `broadcast_tx_async` RPC method | 1 | `send_tx` |
| the `EXPERIMENTAL_changes` and `EXPERIMENTAL_changes_in_block` RPC methods | 1 | `changes` and `block_effects` |

On the finding types of the first count alone, it is 46 of 162 (28%).

## Method

1. **Projects.** All 277 entries of `https://nearhackathon.com/api/projects` on 8 November.
2. **Repositories.**
   - 121 projects link a GitHub repository in the post their `demo_url` points to; 118 of those cloned, 3 are private or gone.
   - For 44 more, a GitHub search found exactly one repository whose name equals the project's short name, with NEAR in its name or description and a push after 15 October. Ambiguous hits were dropped, so this step finds fewer repositories than it could.
   - The rest had no public repository that could be tied to them, and are not counted.
3. **Check.** A shallow clone of each repository's default branch was run through the `check_code` that the API and the GitHub Action use, against a copy of the live index on 8 November (149 entries). Nothing in the clones was installed or run. A project counts when at least one line qualifies. A line qualifies when:
   - its entry is a strong signal with the status deprecated, removed or changed;
   - it sits in real code: not a test, fixture, example or docs file, and not a comment.
4. **Left out on purpose.**
   - Unpaginated `view_access_key_list` calls. They only fail for accounts with more than 100 keys.
   - `EXPERIMENTAL_tx_status`. Its own entry says to keep it until every node you call runs nearcore 2.14.
5. **Robustness.** Counting only the 118 repositories linked from the posts gives 34 of 118 (29%); on 3 November it was 12 of 46 (26%).

The first count found one wrong entry in the index. near-sdk 5.25.0's note "remove `global-contracts` feature gates" had been read as the feature being removed, but the feature still exists in 5.30.0. The release-note reader was fixed, and that project was not counted.

## Reproduce

```bash
# clone the repositories you want to measure into one directory, then:
npx tsx scripts/count-stale-repos.ts <directory>
```

The script prints the aggregate numbers above. It prints repository names only with `--names`; this report names none.
