# Stale NEAR code in NEAR Hackathon projects

Measured on 3 November 2026, eleven days before the deadline.

**19 of the 67 projects with a public repository use something NEAR deprecated, removed or changed (28%). Among the 40 that use NEAR's JavaScript libraries, it is 16 (40%).**

These are projects started in the last two weeks, by people writing NEAR code today. Each finding is a NEAR change that this code has not caught up with.

## What they use

| What | Projects | What replaces it |
| --- | --- | --- |
| `keyStores` from near-api-js (gone in near-api-js 7) | 11 | a `KeyPairSigner`, or a `KeyPairString` passed to `new Account()` |
| the `@near-js/*` packages, which stopped at 2.5.1 | 6 | `near-api-js` 7.x |
| `actionCreators` (renamed to `actions` in near-api-js 7) | 4 | `actions`, with `addFullAccessKey` and `addFunctionCallKey` instead of `addKey` |
| the `broadcast_tx_commit` RPC method | 2 | `send_tx` |
| a Pagoda RPC endpoint, which refuses requests | 1 | an endpoint from the RPC providers list |
| the `EXPERIMENTAL_genesis_config` RPC method | 1 | `genesis_config` |

Separately, 11 projects pin `near-api-js` 3.x, 4.x or 5.x; the current release line is 7.x.

## Method

1. **Projects.** All 89 entries of `https://nearhackathon.com/api/projects` on 3 November.
2. **Repositories.**
   - 46 projects link their repository in the post their `demo_url` points to.
   - For 21 more, a GitHub search found a repository with the project's name, NEAR in its description, and a push after 15 October.
   - Links to official NEAR repositories and one unrelated search hit were dropped.
   - 22 projects had no public repository that could be tied to them, and are not counted.
3. **Check.** A shallow clone of each repository's default branch was run through the `check_code` that the API and the GitHub Action use, with the index rebuilt on 3 November (136 entries). A project counts when at least one line qualifies. A line qualifies when:
   - its entry is a strong signal with the status deprecated, removed or changed;
   - it sits in real code: not a test, fixture, example or docs file, and not a comment.
4. **Left out on purpose.**
   - Unpaginated `view_access_key_list` calls. They appear in 17 repositories, but they only fail for accounts with more than 100 keys.
   - `EXPERIMENTAL_tx_status`. Its own entry says to keep it until every node you call runs nearcore 2.14.
5. **Robustness.** Counting only the 46 repositories linked from the posts gives 12 of 46 (26%).

The count found one wrong entry in the index. near-sdk 5.25.0's note "remove `global-contracts` feature gates" had been read as the feature being removed, but the feature still exists in 5.30.0. The release-note reader was fixed, and that project is not counted.

## Reproduce

```bash
# clone the repositories you want to measure into one directory, then:
npx tsx scripts/count-stale-repos.ts <directory>
```

The script prints the aggregate numbers above. It prints repository names only with `--names`; this report names none.
