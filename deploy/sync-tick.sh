#!/usr/bin/env bash
# NEAR-pedia — bucketed sync runner (every source is a plain fetch). Invoked
# from cron per tier:
#   fast    — every 5 min  : failure alerts (cheap, in-DB)
#   medium  — every 15 min : github releases, protocol state + upgrade votes (RPC), gov.near.org forum, House of Stake, radar
#   slow    — every 6 h    : docs.near.org, npm + crates.io packages, deprecation build, open GitHub issues/PRs and discussions + embed
#   daily   — once a day   : NEAR GitHub org repos + READMEs, a full (no-ETag) releases read,
#                             YouTube + transcripts, catalog, incidents, partner docs, the Nomicon, NEPs,
#                             the near.org and near.ai blogs + embed, the DB anchor, then the checks
#   weekly  — Mondays      : full forum and blog re-read
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
  fast)   run check-failures ;;
  medium) run sync-github-releases; run sync-protocol; run sync-forum; run sync-hos; run refresh-radar; run check-radar-expiry; run check-reranker; run check-embeddings ;;
  slow)   run sync-docs; run sync-packages; run build-deprecations; run sync-github-discussions; run sync-github-items; run sync-network-stats; embed ;;
  daily)  run sync-repos; run sync-github-releases --full; run build-deprecations; run sync-youtube; run sync-youtube-transcripts; run sync-ecosystem; run sync-incidents; run sync-partner-docs; run sync-site-docs; run sync-neps; run sync-blog; run check-ecosystem-liveness; embed; run migrate-vocab; run anchor-db; run check-scheduled; run check-sql; run check-completeness; run check-endpoints; run check-sources; run check-vec; run check-deadlines; run check-deployed; run check-served; run check-writers-succeeding; run check-conflict-targets; run check-upstream-echo; run check-agent-errors; run check-corpus-balance; run check-doc-structure; run check-doc-chrome; run check-index-freshness; run check-index-coverage; run check-source-layers; run check-completion; run check-refusals; run check-fencing; run check-doc-trust; run check-lookups; run check-order-keys; run check-prune-guards; run check-cuts; run check-network-stats; run check-latency; run check-containers; run check-facets; run check-radar-parity; run check-error-catalog; run check-index-validity; run check-changes-parity; run check-db-rows; run check-fts-freshness; run check-delete-policy; run check-corpus-text; run check-truncation; run check-citations; run check-handoffs; run check-reachable; run check-counters; run check-concepts; run check-formats; run check-inputs; run check-published-totals; run check-qualifiers; run check-retrieval; run check-release-stability; run check-version-lines; run check-oracles; run prune-logs ;;
  weekly) run sync-forum --full; run sync-blog --full ;;
  all)    for s in sync-docs sync-packages sync-repos sync-github-releases sync-protocol sync-forum sync-hos refresh-radar sync-github-discussions sync-github-items sync-network-stats sync-ecosystem sync-incidents sync-partner-docs sync-site-docs sync-neps sync-blog sync-youtube; do run "$s"; done; embed ;;
  *) echo "usage: $0 {fast|medium|slow|daily|weekly|all}" >&2; exit 2 ;;
esac
