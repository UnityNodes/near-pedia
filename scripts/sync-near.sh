#!/usr/bin/env bash
# One full fill of the database from live sources: what `npm run sync:near`
# runs. Every step reads its source live and stops the fill if it fails.
#
# GITHUB_TOKEN is required: the repository, release and README reads need
# more than the 60 calls an hour GitHub gives without one, so an
# unauthenticated run died on a 403 minutes in. Without a token the script
# stops before the first step and points at npm run db:seed, which fills a
# local database from a committed fixture with no network. Without NEARAI_API_KEY the
# meaning index (embeddings) is skipped and semantic_search matches words.
# Two sources arrive in full later, on the schedule: forum posts are read
# for the 300 most recent threads here (every topic is listed; all posts
# would take an hour), and YouTube transcripts are left out (YouTube
# rate-limits a server after a few hundred pages, so they arrive over days).
set -uo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${GITHUB_TOKEN:-}" ]] && ! grep -qs '^GITHUB_TOKEN=.' .env.local; then
  cat >&2 <<'MSG'
sync:near needs GITHUB_TOKEN. Unauthenticated GitHub allows 60 calls an hour,
and the repository, release and README steps need more, so the run would stop
on a 403 partway through.

  Offline, no keys, under a second: npm run db:seed
  Full index (45 to 60 minutes):     GITHUB_TOKEN=<a token with no scopes> npm run sync:near
MSG
  exit 2
fi

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
step sync-github-items
step sync-github-discussions
if [[ -n "${NEARAI_API_KEY:-}" ]]; then
  step build-embeddings
else
  echo "== build-embeddings skipped: no NEARAI_API_KEY, so semantic_search matches words only"
fi
