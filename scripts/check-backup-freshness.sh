#!/usr/bin/env bash
set -uo pipefail

DB="${PEDIA_DB:-/srv/nearpedia/data/nearpedia.db}"
MAX_HOURS="${BACKUP_MAX_AGE_HOURS:-36}"

log_run() {
  local esc="${4//\'/\'\'}"
  sqlite3 "$DB" "INSERT INTO sync_log (source, status, items_synced, ran_at, error)
    VALUES ('$1', '$2', $3, '$(date -u +%FT%T.000Z)', $( [[ -n "$4" ]] && echo "'$esc'" || echo NULL ));" \
    || echo "[$(date -Iseconds)] WARNING: could not write sync_log row for $1" >&2
}

[[ -f "$DB" ]] || { echo "[$(date -Iseconds)] backup-freshness: no database at $DB" >&2; exit 2; }

now=$(date -u +%s)
problems=()
for source in backup-db backup-offbox; do
  last=$(sqlite3 "$DB" "SELECT MAX(ran_at) FROM sync_log WHERE source = '$source' AND status = 'success';")
  if [[ -z "$last" ]]; then
    problems+=("$source: no successful run recorded")
    continue
  fi
  age=$(( (now - $(date -u -d "$last" +%s)) / 3600 ))
  if (( age > MAX_HOURS )); then
    problems+=("$source: last success ${age} h ago ($last), limit ${MAX_HOURS} h")
  else
    echo "[$(date -Iseconds)] backup-freshness: $source ok, last success ${age} h ago ($last)"
  fi
done

if (( ${#problems[@]} > 0 )); then
  msg=$(printf '%s; ' "${problems[@]}")
  msg="${msg%; }"
  echo "[$(date -Iseconds)] backup-freshness STALE: $msg" >&2
  log_run backup-freshness error 0 "$msg"
  exit 1
fi
log_run backup-freshness success 2 ""
