# NEARpedia check for pull requests

A GitHub Action that reads the files a pull request changes, runs each JS/TS, Rust, `Cargo.toml` and `package.json` file through NEARpedia's `check_code`, and leaves one comment listing every line that uses something NEAR deprecated, removed or changed, with the replacement and the source it comes from. Lines the pull request adds come first; findings elsewhere in the changed files are folded below. The comment is updated in place on every push.

## Use it

`.github/workflows/nearpedia.yml`:

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

No key is needed. Pin `@main` to a commit SHA if you want the action itself to stay fixed.

| Input | Default | Meaning |
| --- | --- | --- |
| `fail-on` | `never` | `warning` or `error` fails the job when lines the pull request adds have findings of that severity or worse |
| `comment` | `true` | `false` writes the report to the job summary and annotations only |
| `max-files` | `40` | the most changed files checked in one run |
| `api-url` | `https://near-pedia.xyz` | another NEARpedia instance, for example one you run yourself |

Outputs: `findings` (all findings in the changed files) and `new-findings` (on added lines).

## What it sends where

The action reads the pull request's changed files through the GitHub API with the job's token, and sends each checked file, one per request and at most 20,000 characters, to `POST <api-url>/api/v1/check-code`. NEARpedia checks it in memory and does not store it. Nothing else leaves the runner. On a pull request from a fork the job's token cannot comment, so the report goes to the job summary and to annotations on the changed lines.

## Try it without a repository

Run it against any public pull request with a token that can read it:

```bash
echo "{\"pull_request\":$(curl -s https://api.github.com/repos/near-examples/coin-flip-examples/pulls/37)}" > /tmp/event.json
GITHUB_EVENT_PATH=/tmp/event.json GITHUB_REPOSITORY=near-examples/coin-flip-examples GITHUB_STEP_SUMMARY=/tmp/report.md \
  INPUT_COMMENT=false node github-action/index.mjs
cat /tmp/report.md
```

On 3 November 2026 that pull request added 7 such lines: the `@near-js/*` packages that near-api-js 7 replaced, and dependencies whole breaking lines behind.
