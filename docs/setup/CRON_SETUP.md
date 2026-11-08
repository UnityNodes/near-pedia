# Sync cron — setup and troubleshooting

This box (`/srv/nearpedia`, a Linux VPS) drives all data syncs from the
**root crontab**, not any app-level scheduler. There is no Windows Task
Scheduler anywhere in this stack — if you're looking at a `schtasks.exe` /
`D:\...` version of this file, it described a different, no-longer-real setup
and has been replaced with what's actually running.

## The real crontab

```bash
sudo -n crontab -l -u root
```

```cron
2-59/5 * * * * /srv/nearpedia/deploy/sync-tick.sh fast   >> /var/log/nearpedia-sync.log 2>&1
7-59/15 * * * * /srv/nearpedia/deploy/sync-tick.sh medium >> /var/log/nearpedia-sync.log 2>&1
20 */6 * * *   /srv/nearpedia/deploy/sync-tick.sh slow   >> /var/log/nearpedia-sync.log 2>&1
45 3 * * *     /srv/nearpedia/deploy/sync-tick.sh daily  >> /var/log/nearpedia-sync.log 2>&1
50 4 * * 1     /srv/nearpedia/deploy/sync-tick.sh weekly >> /var/log/nearpedia-sync.log 2>&1
* * * * *      /usr/local/bin/nearpedia-watchdog.sh
# NEARpedia: hourly staleness check against /api/metrics on the box (see Watchdog below)
27 * * * *     bash -c 'set -a; . /srv/nearpedia/.env.production; set +a; BASE_URL=http://127.0.0.1:3130 /srv/nearpedia/scripts/check-sync-staleness.sh' >> /var/log/nearpedia-staleness.log 2>&1
# NEARpedia — daily DB backup, local + off-box to gdrive:nearpedia-backups (docs/setup/CRON_SETUP.md)
20 5 * * *     PEDIA_OFFBOX_REMOTE=gdrive:nearpedia-backups RCLONE_CONFIG=/home/claude/.config/rclone/rclone.conf /srv/nearpedia/scripts/backup-db.sh >> /var/log/nearpedia-backup.log 2>&1
```

The buckets are offset from the other projects on this box (`2-59/5`, `7-59/15`, `:20`, `03:45`, `04:50`), and the backup runs at 05:20 UTC, after the other projects' backups (03:00 to 04:30) and outside the Monday weekly bucket. The staleness check runs at :27, clear of the other projects' hourly checks (:00, :12, :17) and of the backup freshness check at :40.

## What each bucket does

Buckets are defined in **`deploy/sync-tick.sh`**, invoked as
`sync-tick.sh {fast|medium|slow|daily|weekly|all}`. Re-read the script itself
for the current, authoritative list — this is a summary, not a mirror:

- **`fast`** (every 5 min) — `check-failures` only (cheap, in-DB, no network).
- **`medium`** (every 15 min) — `sync-github-releases`, `sync-protocol`,
  `sync-forum`, `sync-hos`, then `refresh-radar` and its expiry check.
- **`slow`** (every 6 h) — `sync-docs`, `sync-packages`, `build-deprecations`,
  `sync-github-discussions`, `sync-github-items`, `sync-network-stats`, then
  `build-embeddings`.
- **`daily`** (03:45) — `sync-repos`, the full releases read, the YouTube,
  ecosystem, incident, partner-docs, Nomicon, NEP and blog syncs,
  `build-embeddings`, `anchor-db`, then the full `check-*.ts` suite (dozens of
  scripts — `check-sql`, `check-completeness`, `check-citations`,
  `check-fencing`, and many more), finishing with `prune-logs`.
- **`weekly`** (Mondays 04:50) — `sync-forum --full`, `sync-blog --full`.
- **`all`** — every plain-fetch sync in one pass + embed; not on cron, run by
  hand for a first data load or a full backfill (`deploy/sync-tick.sh all`).

Each bucket takes an exclusive lock (see below), so overlapping runs of the
*same* bucket skip rather than stack; different buckets run concurrently.

Every sync script is invoked as `npx tsx scripts/<name>.ts` — there is no
build step for any of this; editing a script under `scripts/` changes cron's
next run, live, with no restart.

## Backups

`scripts/backup-db.sh` runs once a day from the root crontab, not from a sync-tick bucket:

1. It copies the live database with `VACUUM INTO`, checks the copy with `PRAGMA integrity_check`, and runs `ANALYZE` on the live database.
2. It gzips the copy to `/var/backups/nearpedia/nearpedia-YYYY-MM-DD.db.gz` and keeps 30 days there.
3. It uploads the copy to `gdrive:nearpedia-backups` with rclone, verifies the checksum with `rclone check`, keeps 7 daily copies and, from Sundays, 4 weekly copies in `weekly/`.

The local copies sit on the same RAID0 stripe as the live database, so the Drive copy is the one that survives the box.

- **Remote.** `gdrive` in `/home/claude/.config/rclone/rclone.conf`: the team's Google Drive account, `drive.file` scope. The folder `nearpedia-backups` is this project's alone; other projects' folders on the same Drive are not touched. The script defaults to this remote and config; the cron line also sets both, so it does not depend on which copy of the script is deployed.
- **Outcome rows.** Each run writes one `sync_log` row per leg: `backup-db` and `backup-offbox`. An off-box failure logs an error row but does not fail the local backup.
- **Freshness.** `scripts/check-backup-freshness.sh` writes `backup-freshness` as an error row when the last successful `backup-db` or `backup-offbox` row is more than 36 hours old (`BACKUP_MAX_AGE_HOURS`). `lib/schedule.ts` gives these sources a deadline, so `check-failures` treats such a row as an open failure and `/api/metrics` publishes their age.
- **Restore drill.** `scripts/backup-restore-drill.sh` restores the newest local copy and the newest Drive copy, downloaded fresh, into scratch databases beside the live one. It checks both with `integrity_check` and compares the row counts of six key tables against live: a restore must hold at least 80%. It writes `restore-drill-local` and `restore-drill-offbox`.

Cron lines for the last two, to install once they are deployed to `/srv/nearpedia`:

```cron
40 * * * *     /srv/nearpedia/scripts/check-backup-freshness.sh >> /var/log/nearpedia-backup.log 2>&1
40 5 * * 2     /srv/nearpedia/scripts/backup-restore-drill.sh   >> /var/log/nearpedia-backup.log 2>&1
```

Where to look:

```bash
tail -50 /var/log/nearpedia-backup.log
sudo ls -la /var/backups/nearpedia/
sudo rclone lsl gdrive:nearpedia-backups --config /home/claude/.config/rclone/rclone.conf
sqlite3 /srv/nearpedia/data/nearpedia.db "SELECT source, status, ran_at, error FROM sync_log WHERE source LIKE 'backup%' OR source LIKE 'restore-drill%' ORDER BY id DESC LIMIT 10;"
```

To restore: download the file and `gunzip` it, stop both services (`systemctl stop nearpedia nearpedia-mcp`), move the old `data/nearpedia.db` and its `-wal` and `-shm` files aside, put the restored file in its place, and start both services again.

## Logs

```bash
tail -f /var/log/nearpedia-sync.log        # sync-tick.sh output
tail -f /var/log/nearpedia-backup.log      # backup, freshness check and restore drill
```

Both files are plain `>>` appends with no rotation configured in the crontab
itself — `/var/log/nearpedia-sync.log` grows unbounded (it was already ~19 MB
at last check); rotate it externally (`logrotate` or a manual truncate) if
that becomes a problem, `sync-tick.sh` does not do this for you.

Each line is prefixed `[<bucket> <ISO-8601 timestamp>] <script> [ok|FAILED]`,
e.g.:

```
[slow 2026-09-02T18:00:03+00:00] sync-docs
[slow 2026-09-02T18:00:11+00:00] sync-docs ok
```

## Verifying a sync actually ran (and actually did something)

A script exiting 0 is not proof the data changed — query the `sync_log`
table it writes to instead:

```bash
export PATH=/root/.nvm/versions/node/v22.18.0/bin:$PATH
cd /srv/nearpedia
sqlite3 data/nearpedia.db \
  "SELECT source, status, items_synced, ran_at FROM sync_log ORDER BY id DESC LIMIT 15;"
```

`status` is one of `success` / `partial` / `error` (not just pass/fail —
`check-*` scripts log `partial` when some but not all of what they checked
came back clean). `source` is the script's own log label, which does not
always match its filename 1:1 (e.g. `scripts/sync-github-releases.ts` logs as
`github-releases`). Two different mechanisms write the row (`logRun()` for a
single call, `guardSync()` wrapping a whole entry point for a batch), so
grepping a script by hand can miss one. `lib/logged-source.ts`'s
`loggedSourceOf(script)` is the canonical resolver — it reads the script's own
source to find which one it uses and what name it logs under; use that
instead of guessing from the filename.

## Lock files

Each `sync-tick.sh` bucket holds `flock` on its own file for the duration of
the run:

```bash
ls -la /run/nearpedia-sync-*.lock
```

A run that "should have happened" but didn't touch `sync_log` or the log file
usually means the *previous* run of that same bucket was still holding the
lock (a slow upstream fetch, a hung network call) — `sync-tick.sh` logs
`previous run still going, skip` in that case rather than queuing. A hung
script cannot hold the lock for ever: `exec_script` runs each one under
`timeout -k 30 $CAP`, with `CAP` from `BUCKET_CAP` at the top of the script
(fast and medium 600 s, slow 1800 s, daily and weekly 7200 s). A script that hits
the cap is logged as `<script> TIMED OUT after <CAP>s` and gets an error row in
`sync_log` through `alert-crash`. The locks are `/run`
(tmpfs), so they don't survive a reboot — that's intentional, a fresh boot
should never start up already "locked".

## Watchdog

`/usr/local/bin/nearpedia-watchdog.sh` runs every minute, independent of the
sync buckets:

```bash
curl -fs --max-time 10 http://127.0.0.1:3130/api/health >/dev/null 2>&1 || systemctl restart nearpedia
curl -fs --max-time 10 http://127.0.0.1:3131/health      >/dev/null 2>&1 || systemctl restart nearpedia-mcp
```

This restarts the **web app or MCP server process**, not a sync — it has
nothing to do with whether data is fresh, only whether the two services are
answering. Staleness (data not being refreshed) is a separate concern: `/api/metrics`
publishes each source's age beside its deadline, and
`scripts/check-sync-staleness.sh` reads it every hour from the crontab line above.
It calls `http://127.0.0.1:3130`, which `/api/metrics` lets through without
`METRICS_TOKEN`, sources `.env.production` for `TELEGRAM_BOT_TOKEN` /
`TELEGRAM_CHAT_ID` (or `SLACK_WEBHOOK_URL`) and sends the stale list there when
they are set; without them it only writes `/var/log/nearpedia-staleness.log`.
Exit 1 means stale, 2 means it could not read the metrics at all. Touch
`/var/run/nearpedia-quiet` to silence alerts during maintenance.

## Troubleshooting checklist

1. **Is cron even installed for this?** `sudo -n crontab -l -u root | grep nearpedia`
2. **Did the last run of a bucket complete?** `grep '\[daily ' /var/log/nearpedia-sync.log | tail -40`
3. **Did it write real rows, not just exit 0?** the `sync_log` query above —
   compare `ran_at` against "now"; a source stuck hours behind its bucket's
   cadence is the actual signal, not the log tail.
4. **Is a bucket stuck on its lock?** `ls -la /run/nearpedia-sync-*.lock` plus
   `ps aux | grep tsx` to see if something is still running under it.
5. **Root's git ownership.** `/srv/nearpedia/.git` is owned by `claude:claude`
   while cron runs sync scripts as root, which is exactly the setup where git
   normally refuses with `detected dubious ownership`. The one place this repo
   shells out to git (`mcp-server.ts`, resolving the running commit for
   `/api/health`) passes `-c safe.directory=<repo-root>` inline on that one
   call rather than relying on a pre-existing global git config — so there is
   nothing to configure once for cron's sake. If you add a sync script that
   shells out to `git` directly, give it the same inline flag rather than
   assuming a global `safe.directory` entry exists; `/srv/nearpedia` is not
   in root's `git config --global safe.directory` list.
6. **Wrong Node.** `sync-tick.sh` hardcodes
   `PATH=/root/.nvm/versions/node/v22.18.0/bin:...` at the top specifically so
   cron (which does not source a login shell / `.bashrc`) doesn't fall back to
   a system Node that can't load `better-sqlite3`. If you're reproducing a
   failure by hand, export that same PATH first or you'll "fix" something
   that was never broken under cron.
