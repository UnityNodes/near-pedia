#!/usr/bin/env bash
#
# nearpedia - SQLite WAL-safe backup with retention, plus an off-box leg.
#
# Run from root cron once a day (docs/setup/CRON_SETUP.md); sync-tick does not call it. Uses sqlite3
# `VACUUM INTO` so it copies a live DB in WAL mode from one snapshot without
# locking out readers/writers.
#
# WHY THE OFF-BOX LEG EXISTS. The 2026-08-29 audit found / is a two-NVMe
# RAID0 stripe (md2) holding BOTH the live DB and every local backup: one
# disk failure destroys all copies at once. The rclone push below is the
# only copy that survives the box.
#
# Both legs write their outcome to sync_log (sources `backup-db` and
# `backup-offbox`), because a backup that silently stops running is the
# failure mode that hurts months later. An off-box failure does not fail
# the local backup: it logs its own error row and the script still exits 0.
#
# Env vars (optional):
#   PEDIA_DB             — source DB       (default: /srv/nearpedia/data/cips.db)
#   PEDIA_BACKUP_DIR     — local dir       (default: /var/backups/nearpedia)
#   RETENTION_DAYS         — local keep days (default: 30)
#   PEDIA_OFFBOX_REMOTE  — rclone target   (default: remote:nearpedia-backups)
#   OFFBOX_RETENTION_DAYS  — remote keep days for the daily copies (default: 7)
#   OFFBOX_WEEKLY_DAYS     — remote keep days for the Sunday copies in weekly/
#                            (default: 29, i.e. four of them)
#   RCLONE_CONFIG          — rclone config   (default: ~/.config/rclone/rclone.conf
#                            of the user that runs the backup)

set -uo pipefail

DB="${PEDIA_DB:-/srv/nearpedia/data/cips.db}"
DIR="${PEDIA_BACKUP_DIR:-/var/backups/nearpedia}"
RETAIN="${RETENTION_DAYS:-30}"
REMOTE="${PEDIA_OFFBOX_REMOTE:-remote:nearpedia-backups}"
OFFBOX_RETAIN="${OFFBOX_RETENTION_DAYS:-7}"
OFFBOX_WEEKLY_RETAIN="${OFFBOX_WEEKLY_DAYS:-29}"
export RCLONE_CONFIG="${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}"

# One row per leg. sqlite3 has no bound params; single quotes in the error
# text are doubled so a quote in an rclone message cannot break the INSERT.
log_run() { # source status items error
  local esc="${4//\'/\'\'}"
  sqlite3 "$DB" "INSERT INTO sync_log (source, status, items_synced, ran_at, error)
    VALUES ('$1', '$2', $3, '$(date -u +%FT%T.000Z)', $( [[ -n "$4" ]] && echo "'$esc'" || echo NULL ));" \
    || echo "[$(date -Iseconds)] WARNING: could not write sync_log row for $1" >&2
}

if [[ ! -f "$DB" ]]; then
  echo "[$(date -Iseconds)] backup FAILED: source DB not found at $DB" >&2
  exit 1
fi

mkdir -p "$DIR"

STAMP=$(date +%F)
DEST="$DIR/cips-$STAMP.db"

echo "[$(date -Iseconds)] backing up $DB -> $DEST"

# VACUUM INTO copies one read snapshot. .backup starts over from the first
# page whenever anything else writes, so under steady writes it never finishes:
# a 2.4 GB database written to every second took 7 GB of writes in 10 minutes
# and was still not copied.
rm -f "$DEST" "$DEST-journal"
if ! sqlite3 -cmd '.timeout 15000' "$DB" "VACUUM INTO '$DEST'"; then
  echo "[$(date -Iseconds)] backup FAILED: VACUUM INTO" >&2
  log_run backup-db error 0 "VACUUM INTO failed"
  exit 1
fi

# Prove the copy before it can replace anything: a damaged page would otherwise
# be copied faithfully, uploaded, and rotate every good copy out. A copy that
# fails is kept aside as .corrupt and the run stops before pruning and upload.
CHECK=$(sqlite3 "$DEST" "PRAGMA integrity_check;" 2>&1 | head -c 300)
if [[ "$CHECK" != "ok" ]]; then
  mv -f "$DEST" "$DEST.corrupt" 2>/dev/null || true
  echo "[$(date -Iseconds)] backup FAILED: integrity_check on the copy: $CHECK" >&2
  log_run backup-db error 0 "integrity_check failed on the copy, nothing rotated or uploaded: $CHECK"
  exit 1
fi

# Update query-planner statistics on the LIVE DB after a successful
# backup. ANALYZE is cheap on SQLite (single read pass per index) and
# stale stats are the most common cause of unexpectedly slow queries
# after large syncs. Doing it right after the backup means the backup
# captures the post-ANALYZE sqlite_stat tables too.
sqlite3 "$DB" "ANALYZE;" || echo "[$(date -Iseconds)] ANALYZE warning (continuing)"

# Gzip to save space (a fresh nearpedia DB is ~200MB, compresses ~5x).
if ! gzip -f "$DEST"; then
  log_run backup-db error 0 "gzip failed for $DEST"
  exit 1
fi

# The backup is a full copy of the production DB; no reason for it to be
# world-readable (the box carries unrelated login users).
chmod 600 "$DEST.gz" || true

# Prune older than RETAIN days.
find "$DIR" -type f -name 'cips-*.db.gz' -mtime "+$RETAIN" -print -delete

SIZE=$(du -h "$DEST.gz" | cut -f1)
COUNT=$(find "$DIR" -name 'cips-*.db.gz' | wc -l)
echo "[$(date -Iseconds)] backup ok — $DEST.gz ($SIZE), $COUNT backups retained"
log_run backup-db success 1 ""

# ── Off-box leg ─────────────────────────────────────────────────────────────
if ! command -v rclone >/dev/null; then
  log_run backup-offbox error 0 "rclone not installed"
  exit 0
fi

echo "[$(date -Iseconds)] off-box: $DEST.gz -> $REMOTE/"
if rclone copyto "$DEST.gz" "$REMOTE/cips-$STAMP.db.gz" \
     --timeout 10m --retries 3 --low-level-retries 10 2>/tmp/nearpedia-offbox-err.$$ \
   && rclone check "$DIR" "$REMOTE" --include "cips-$STAMP.db.gz" --one-way --max-depth 1 \
     --timeout 5m 2>>/tmp/nearpedia-offbox-err.$$; then
  # Checksum verified against the remote (Drive holds md5; no download).
  # Sundays also keep a weekly copy (server-side copy, no re-upload).
  if [[ $(date +%u) == 7 ]]; then
    rclone copyto "$REMOTE/cips-$STAMP.db.gz" "$REMOTE/weekly/cips-$STAMP.db.gz" \
      --timeout 10m 2>>/tmp/nearpedia-offbox-err.$$ \
      || echo "[$(date -Iseconds)] off-box weekly copy FAILED (daily copy is fine)" >&2
  fi
  # --max-depth 1: include patterns match at any depth, so without it the
  # daily rule would also delete the weekly copies.
  rclone delete "$REMOTE" --min-age "${OFFBOX_RETAIN}d" --include 'cips-*.db.gz' --max-depth 1 \
    --timeout 5m 2>>/tmp/nearpedia-offbox-err.$$ || true
  rclone delete "$REMOTE/weekly" --min-age "${OFFBOX_WEEKLY_RETAIN}d" --include 'cips-*.db.gz' \
    --timeout 5m 2>>/tmp/nearpedia-offbox-err.$$ || true
  RCOUNT=$(rclone lsf "$REMOTE" --files-only --include 'cips-*.db.gz' 2>/dev/null | wc -l)
  WCOUNT=$(rclone lsf "$REMOTE/weekly" --files-only --include 'cips-*.db.gz' 2>/dev/null | wc -l)
  echo "[$(date -Iseconds)] off-box ok — checksum verified, $RCOUNT daily + $WCOUNT weekly remote copies"
  log_run backup-offbox success 1 ""
else
  ERR=$(tail -c 300 "/tmp/nearpedia-offbox-err.$$" 2>/dev/null | tr '\n' ' ')
  echo "[$(date -Iseconds)] off-box FAILED: $ERR" >&2
  log_run backup-offbox error 0 "rclone: ${ERR:-unknown error}"
fi
rm -f "/tmp/nearpedia-offbox-err.$$"
