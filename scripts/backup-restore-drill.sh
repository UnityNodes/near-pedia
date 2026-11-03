#!/usr/bin/env bash
set -uo pipefail

DB="${PEDIA_DB:-/srv/nearpedia/data/nearpedia.db}"
DIR="${PEDIA_BACKUP_DIR:-/var/backups/nearpedia}"
REMOTE="${PEDIA_OFFBOX_REMOTE:-gdrive:nearpedia-backups}"
export RCLONE_CONFIG="${RCLONE_CONFIG:-/home/claude/.config/rclone/rclone.conf}"
MIN_RATIO="${MIN_RATIO:-80}"
DRILL_TMP="${DRILL_TMP:-$(dirname "$DB")}"
TABLES=(doc_pages deprecations forum_topics github_items embedding_chunks hos_proposals)

log_run() {
  local esc="${4//\'/\'\'}"
  sqlite3 "$DB" "INSERT INTO sync_log (source, status, items_synced, ran_at, error)
    VALUES ('$1', '$2', $3, '$(date -u +%FT%T.000Z)', $( [[ -n "$4" ]] && echo "'$esc'" || echo NULL ));" \
    || echo "[$(date -Iseconds)] WARNING: could not write sync_log row for $1" >&2
}

drill_leg() {
  local source="$1" gz="$2" label="$3"
  local tmp="$DRILL_TMP/.restore-drill.$source.tmp.db"
  rm -f -- "$tmp" "$tmp-wal" "$tmp-shm"

  if [[ ! -f "$gz" ]]; then
    echo "  [$source] FAIL: no backup file ($label)" >&2
    log_run "$source" error 0 "no backup file: $label"
    return 1
  fi
  if ! gunzip -c "$gz" > "$tmp" 2>/dev/null; then
    echo "  [$source] FAIL: gunzip failed for $label" >&2
    log_run "$source" error 0 "gunzip failed for $label"
    rm -f -- "$tmp"
    return 1
  fi

  local ic
  ic=$(sqlite3 "$tmp" 'PRAGMA integrity_check;' 2>&1 | head -1)
  if [[ "$ic" != "ok" ]]; then
    echo "  [$source] FAIL: integrity_check on $label returned: $ic" >&2
    log_run "$source" error 0 "integrity_check on $label returned: $ic"
    rm -f -- "$tmp" "$tmp-wal" "$tmp-shm"
    return 1
  fi

  local problems=0 detail=""
  for t in "${TABLES[@]}"; do
    local live rest
    live=$(sqlite3 "$DB" "SELECT COUNT(*) FROM $t;" 2>/dev/null || echo -1)
    rest=$(sqlite3 "$tmp" "SELECT COUNT(*) FROM $t;" 2>/dev/null || echo -1)
    if (( rest < 0 )); then
      echo "  [$source] $t: missing or unreadable in the restore" >&2
      detail+="$t: missing; "; problems=$((problems + 1)); continue
    fi
    if (( live > 0 )); then
      local floor=$(( live * MIN_RATIO / 100 ))
      if (( rest < floor )); then
        echo "  [$source] $t: restore=$rest is below ${MIN_RATIO}% of live=$live" >&2
        detail+="$t: $rest < $floor; "; problems=$((problems + 1)); continue
      fi
    fi
    echo "  [$source] $t: ok (restore=$rest live=$live)"
  done
  rm -f -- "$tmp" "$tmp-wal" "$tmp-shm"

  if (( problems > 0 )); then
    log_run "$source" error 0 "$problems table(s) below ${MIN_RATIO}% of live in $label: $detail"
    return 1
  fi
  echo "[$(date -Iseconds)] [$source] OK: $label restores, integrity ok, ${#TABLES[@]} tables within ${MIN_RATIO}% of live"
  log_run "$source" success "${#TABLES[@]}" ""
}

command -v sqlite3 >/dev/null || { echo "sqlite3 not installed" >&2; exit 1; }
[[ -f "$DB" ]] || { echo "live DB not found at $DB" >&2; exit 1; }

overall=0

LOCAL_GZ=$(ls -t "$DIR"/nearpedia-*.db.gz 2>/dev/null | head -1 || true)
drill_leg restore-drill-local "${LOCAL_GZ:-$DIR/none}" "local: $(basename "${LOCAL_GZ:-none}")" || overall=1

if ! command -v rclone >/dev/null; then
  echo "  [restore-drill-offbox] FAIL: rclone not installed" >&2
  log_run restore-drill-offbox error 0 "rclone not installed"
  overall=1
else
  NAME=$(rclone lsf "$REMOTE" --files-only --max-depth 1 --include 'nearpedia-*.db.gz' 2>/dev/null | sort | tail -1 || true)
  if [[ -z "$NAME" ]]; then
    echo "  [restore-drill-offbox] FAIL: no nearpedia-*.db.gz in $REMOTE" >&2
    log_run restore-drill-offbox error 0 "no backup file in $REMOTE"
    overall=1
  else
    PULLED="$DRILL_TMP/.restore-drill.offbox.$NAME"
    rm -f -- "$PULLED"
    if rclone copyto "$REMOTE/$NAME" "$PULLED" --timeout 10m --retries 3 2>/dev/null; then
      drill_leg restore-drill-offbox "$PULLED" "off-box: $REMOTE/$NAME" || overall=1
    else
      echo "  [restore-drill-offbox] FAIL: download of $REMOTE/$NAME failed" >&2
      log_run restore-drill-offbox error 0 "download of $REMOTE/$NAME failed"
      overall=1
    fi
    rm -f -- "$PULLED"
  fi
fi

exit "$overall"
