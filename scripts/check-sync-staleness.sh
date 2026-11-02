#!/usr/bin/env bash
#
# NEAR-pedia — sync staleness watchdog.
#
# Reads /api/metrics and exits non-zero (and prints to stderr) when a
# scheduled source has not COMPLETED inside the deadline its cron bucket
# implies. Both numbers come from the endpoint - the age and the deadline -
# so this script holds no table of its own.
#
# It is the only layer that outlives its own subject: every check-*.ts runs
# inside a sync-tick bucket, so a dead bucket takes the things that would
# report it; this reaches the box over HTTP and needs neither tsx, nor git,
# nor a bucket.
#
# Cron — every hour, log to file, page on non-zero:
#   0 * * * * /srv/nearpedia/scripts/check-sync-staleness.sh >> /var/log/nearpedia-staleness.log 2>&1
#
# Or wire to Alertmanager via a webhook; this script is a fallback
# for installs that don't run Prometheus yet.
#
# Env:
#   BASE_URL          — defaults to https://near-pedia.xyz
#   METRICS_TOKEN     — if /api/metrics is auth-gated
#   FAIL_ON_STALE     — '1' to exit non-zero (default), '0' to log only
#   SLACK_WEBHOOK_URL — POST stale list to Slack incoming webhook
#   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID — Telegram alert
#   ALERT_QUIET_FILE  — touch this file to suppress alerts (e.g. during
#                       a planned maintenance window); default
#                       /var/run/nearpedia-quiet.

set -uo pipefail

BASE="${BASE_URL:-https://near-pedia.xyz}"
TOKEN="${METRICS_TOKEN:-}"
FAIL_ON_STALE="${FAIL_ON_STALE:-1}"
QUIET_FILE="${ALERT_QUIET_FILE:-/var/run/nearpedia-quiet}"

# No threshold table here on purpose. There was one, keyed by SCRIPT name
# against a gauge labelled by SOURCE name - "check-completeness" (the script)
# against "completeness" (what it actually logs to sync_log via
# guardSync('completeness', main)) - so that entry, and others like it,
# never matched and fell through to the 24h default for the whole life of
# the script. A five-minute sync could go a day stale with the tuning
# underneath it doing nothing.
#
# The deadline now arrives with the reading: /api/metrics publishes
# nearpedia_sync_tolerance_seconds beside nearpedia_sync_completion_age_seconds,
# both computed from deploy/sync-tick.sh in lib/schedule.ts, in
# one place.

url="$BASE/api/metrics"
if [[ -n "$TOKEN" ]]; then
  url="$url?token=$TOKEN"
fi

metrics=$(curl -sS -m 15 "$url" 2>&1)
status=$?
if [[ $status -ne 0 || -z "$metrics" ]]; then
  echo "[$(date -Iseconds)] FAIL: could not fetch $url ($status)" >&2
  exit 2
fi

stale=()
seen=()

# nearpedia_sync_completion_age_seconds, NOT a success-only age. 'partial' is
# an honest permanent state for some sources, and judging those by a
# success-only MAX would make them read as stale for ever - an alarm that is
# always on is one nobody reads.
declare -A AGE=()
declare -A TOL=()
while IFS= read -r line; do
  if [[ "$line" =~ ^nearpedia_sync_completion_age_seconds\{source=\"([^\"]+)\"\}[[:space:]]+(-?[0-9]+) ]]; then
    AGE["${BASH_REMATCH[1]}"]="${BASH_REMATCH[2]}"
  elif [[ "$line" =~ ^nearpedia_sync_tolerance_seconds\{source=\"([^\"]+)\"\}[[:space:]]+([0-9]+) ]]; then
    TOL["${BASH_REMATCH[1]}"]="${BASH_REMATCH[2]}"
  fi
done <<<"$metrics"

# Only sources that published a deadline are judged. The rest are one-off
# migrations and backfills, and being old is what finished means for those.
unwatched=0
for src in "${!AGE[@]}"; do
  threshold="${TOL[$src]:-}"
  if [[ -z "$threshold" ]]; then
    unwatched=$((unwatched + 1))
    continue
  fi
  seen+=("$src")
  age="${AGE[$src]}"
  if [[ "$age" -lt 0 ]]; then
    stale+=("$src (has never completed)")
  elif [[ "$age" -gt "$threshold" ]]; then
    stale+=("$src (${age}s > ${threshold}s)")
  fi
done

ts=$(date -Iseconds)

# Seeing nothing is not the same as seeing nothing wrong. With no matching
# lines this would print "0 sources checked, all fresh" and exit 0, so a
# metric that was renamed, an endpoint returning an error page, or a build
# that hasn't shipped the gauge yet all read as a clean bill of health -
# exactly the failure this watchdog exists to catch, one level up.
if [[ ${#seen[@]} -eq 0 ]]; then
  echo "[$ts] FAIL: $url published no scheduled source with both an age and a tolerance; nothing was checked" >&2
  exit 2
fi

if [[ ${#stale[@]} -eq 0 ]]; then
  echo "[$ts] ok — ${#seen[@]} scheduled source(s) checked, all fresh (${unwatched} unscheduled, skipped)."
  exit 0
fi

echo "[$ts] STALE — ${#stale[@]} source(s) past threshold:" >&2
for s in "${stale[@]}"; do
  echo "  - $s" >&2
done

# Webhook alerts. Skipped when ALERT_QUIET_FILE exists so a maintenance
# window doesn't spam channels.
if [[ ! -f "$QUIET_FILE" ]]; then
  stale_body=""
  for s in "${stale[@]}"; do
    stale_body+="• ${s}\n"
  done

  if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
    slack_text="*NEAR-pedia stale sources (${#stale[@]})*\n${stale_body}_(${BASE})_"
    curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
      --data "$(printf '{"text":"%s"}' "${slack_text//\"/\\\"}")" \
      "$SLACK_WEBHOOK_URL" >/dev/null \
      || echo "[$ts] slack webhook failed" >&2
  fi

  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
    tg_text="*NEAR-pedia stale sources (${#stale[@]})*\n${stale_body}_${BASE}_"
    curl -sS -m 10 -X POST \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=$(printf '%b' "$tg_text")" \
      --data-urlencode 'parse_mode=Markdown' \
      --data-urlencode 'disable_web_page_preview=true' >/dev/null \
      || echo "[$ts] telegram alert failed" >&2
  fi
fi

if [[ "$FAIL_ON_STALE" == "1" ]]; then
  exit 1
fi
exit 0
