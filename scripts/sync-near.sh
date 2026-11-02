#!/usr/bin/env bash
# One full fill of the database from live sources: what `npm run sync:near`
# runs. Every step reads its source live and stops the fill if it fails.
#
# Keys are optional. Without GITHUB_TOKEN the open issues, PRs and
# discussions are skipped: 60 unauthenticated GitHub calls an hour do not
# hold them, and discussions need a token at all. Without NEARAI_API_KEY the
# meaning index (embeddings) is skipped and semantic_search matches words.
# Two sources arrive in full later, on the schedule: forum posts are read
# for the 300 most recent threads here (every topic is listed; all posts
# would take an hour), and YouTube transcripts are left out (YouTube
# rate-limits a server after a few hundred pages, so they arrive over days).
set -uo pipefail
cd "$(dirname "$0")/.."

step() {
  echo "== $1"
  npx tsx "scripts/$1.ts" "${@:2}" || exit 1
}

step sync-docs
step sync-partner-docs
step sync-site-docs
step sync-packages
step sync-repos --all-readmes
step sync-github-releases
step build-deprecations
step sync-protocol
FORUM_POST_TOPICS=300 step sync-forum
step sync-hos
step sync-ecosystem
step sync-incidents
step sync-neps
step sync-blog
step sync-youtube
step refresh-radar
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  step sync-github-items
  step sync-github-discussions
else
  echo "== sync-github-items, sync-github-discussions skipped: no GITHUB_TOKEN"
fi
if [[ -n "${NEARAI_API_KEY:-}" ]]; then
  step build-embeddings
else
  echo "== build-embeddings skipped: no NEARAI_API_KEY, so semantic_search matches words only"
fi
