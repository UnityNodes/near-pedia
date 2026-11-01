#!/usr/bin/env bash
# NEAR-pedia — bucketed sync runner (plain-fetch sources; Cloudflare-gated
# forum/blog live in deploy/sync-cf.sh). Invoked from cron per tier:
#   fast    — every 5 min  : refresh-trending (cheap, in-DB)
#   medium  — every 15 min : github releases
#   slow    — every 6 h    : cips, docs, discussions, papers, network-stats + embed
#   daily   — once a day   : youtube + transcripts, ecosystem, repo-docs/rpc enrich + embed,
#                             then check-scheduled/check-sql/check-completeness/check-endpoints/
#                             check-sources
#   weekly  — Mondays      : build weekly digest
# Output -> /var/log/nearpedia-sync.log . Each script is independent.
export PATH=/root/.nvm/versions/node/v22.18.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# This box has no working IPv6 route, and upstreams keep moving to dual-stack
# hosts that resolve AAAA first. Node's fetch then spends its whole connect budget
# on an address that can never answer, where curl falls back in milliseconds, so a
# sync fails while the same URL works from the shell beside it. A forum sync was
# lost for 13 hours to exactly this on the same machine. Remove it the day the
# box gets IPv6, not before.
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--dns-result-order=ipv4first"

BUCKET="${1:-}"
REPO="/srv/nearpedia"
[[ -z "$BUCKET" ]] && { echo "usage: $0 {fast|medium|slow|daily|weekly|all}" >&2; exit 2; }

# Opening the lock can fail for a reason that is NOT "a run is in progress" (a
# permission error, a missing /run), and reporting that as "skip" and exiting 0 is
# a sync that did nothing while reporting the one state in which doing nothing is
# correct.
if ! exec 200>"/run/nearpedia-sync-$BUCKET.lock"; then
  echo "[$BUCKET $(date -Iseconds)] cannot open /run/nearpedia-sync-$BUCKET.lock (permission or missing /run): NOT a lock conflict, nothing ran" >&2
  exit 3
fi
flock -n 200 || { echo "[$BUCKET $(date -Iseconds)] previous run still going, skip"; exit 0; }

cd "$REPO"
set -a; . .env.local 2>/dev/null; . .env.production 2>/dev/null; set +a
stamp() { date -Iseconds; }

# Runs one script and, when it dies, files the sync_log row the script could not
# file for itself. A script that crashes before reaching logRun writes nothing, so
# the newest row it has is its last SUCCESS and every reader of sync_log shows it
# green. check-deployed and check-oracles wrote nothing for 17 nights that way,
# and check-inputs failed with only a line in this text file.
#
# stderr goes to a file and is re-emitted so its head can go into the row. No pipe
# and no process substitution: both put the exit code behind a race. alert-crash
# is best effort, bounded, and files nothing if the script already reported.
exec_script() {
  local label="$1" s="$2"; shift 2
  echo "[$BUCKET $(stamp)] $label"
  local rc=0 err started
  err="$(mktemp)"
  started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  npx tsx "scripts/$s.ts" "$@" 2>"$err" || rc=$?
  cat "$err" >&2
  if (( rc == 0 )); then
    echo "[$BUCKET $(stamp)] $label ok"
  else
    echo "[$BUCKET $(stamp)] $label FAILED (exit $rc)" >&2
    timeout 60 npx tsx scripts/alert-crash.ts "$s" "$rc" "$started" "$(head -c 700 "$err")" || true
  fi
  rm -f "$err"
}
run() { local s="$1"; shift; exec_script "$s" "$s" "$@"; }
embed() { exec_script embed build-embeddings; }

case "$BUCKET" in
  fast)   run refresh-trending; run check-failures ;;
  medium) run sync-github-releases; run refresh-radar; run check-reranker; run check-embeddings ;;
  slow)   run sync-cips; run sync-cip-assets; run sync-docs; run sync-github-discussions; run sync-github-items; run sync-papers; run sync-network-stats; embed ;;
  daily)  run sync-youtube; run sync-youtube-transcripts; run sync-ecosystem; run check-ecosystem-liveness; run sync-foundation; run backfill-tldrs; run enrich-docs; embed; run migrate-vocab; run check-scheduled; run check-sql; run check-completeness; run check-endpoints; run check-sources; run check-vec; run check-deadlines; run check-deployed; run check-served; run check-writers-succeeding; run check-conflict-targets; run check-upstream-echo; run check-agent-errors; run check-corpus-balance; run check-doc-structure; run check-glossary; run check-doc-chrome; run check-index-freshness; run check-index-coverage; run check-source-layers; run check-completion; run check-anchors; run check-refusals; run check-fencing; run check-doc-trust; run check-lookups; run check-order-keys; run check-prune-guards; run check-cuts; run check-network-stats; run check-latency; run check-containers; run check-facets; run check-radar-parity; run check-index-validity; run check-trending-parity; run check-changes-parity; run check-db-rows; run check-fts-freshness; run check-delete-policy; run check-corpus-text; run check-truncation; run check-citations; run check-citations-parity; run check-handoffs; run check-reachable; run check-counters; run check-concepts; run check-formats; run check-inputs; run check-parsed; run check-published-totals; run check-qualifiers; run check-retrieval; run check-release-stability; run check-version-lines; run check-oracles; run prune-logs ;;
  weekly) run build-weekly-digest; run backfill-cip-history; run check-resources ;;
  all)    for s in sync-cips sync-cip-assets sync-docs sync-github-releases refresh-radar sync-github-discussions sync-github-items sync-papers sync-network-stats sync-ecosystem sync-foundation sync-youtube enrich-docs refresh-trending build-weekly-digest; do run "$s"; done; embed ;;
  *) echo "usage: $0 {fast|medium|slow|daily|weekly|all}" >&2; exit 2 ;;
esac
