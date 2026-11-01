# Sync cron — setup and troubleshooting

This box (`/srv/yourpedia`, a Linux VPS) drives all data syncs from the
**root crontab**, not any app-level scheduler. There is no Windows Task
Scheduler anywhere in this stack — if you're looking at a `schtasks.exe` /
`D:\...` version of this file, it described a different, no-longer-real setup
and has been replaced with what's actually running.

## The real crontab

```bash
sudo -n crontab -l -u root
```

```cron
# health watchdog, every minute
* * * * * /usr/local/bin/yourpedia-watchdog.sh

# plain-fetch sync buckets, bucketed by cost/freshness
*/5  * * * *   /srv/yourpedia/deploy/sync-tick.sh fast   >> /var/log/yourpedia-sync.log 2>&1
*/15 * * * *   /srv/yourpedia/deploy/sync-tick.sh medium >> /var/log/yourpedia-sync.log 2>&1
0 */6 * * *    /srv/yourpedia/deploy/sync-tick.sh slow   >> /var/log/yourpedia-sync.log 2>&1
15 3 * * *     /srv/yourpedia/deploy/sync-tick.sh daily  >> /var/log/yourpedia-sync.log 2>&1
30 4 * * 1     /srv/yourpedia/deploy/sync-tick.sh weekly >> /var/log/yourpedia-sync.log 2>&1

# Cloudflare-gated sources (forum, blog) — need a real headful Chrome via xvfb,
# so they run separately from the plain-fetch buckets above
*/30 * * * *   /srv/yourpedia/deploy/sync-cf.sh >> /var/log/yourpedia-sync.log 2>&1

# DB backup
30 4 * * *     PEDIA_DB=/srv/yourpedia/data/cips.db PEDIA_BACKUP_DIR=/srv/yourpedia/data/backups /srv/yourpedia/scripts/backup-db.sh >> /var/log/yourpedia-sync.log 2>&1

# staleness watchdog — hits the live site, not the DB directly
17 * * * *     BASE_URL=http://127.0.0.1:3040 FAIL_ON_STALE=0 /srv/yourpedia/scripts/check-sync-staleness.sh >> /var/log/yourpedia-staleness.log 2>&1
```

(`PEDIA_DB` / `PEDIA_BACKUP_DIR` are historical env-var names carried over
from `backup-db.sh`'s origin; they point at yourpedia's own DB path.)

## What each bucket does

Buckets are defined in **`deploy/sync-tick.sh`**, invoked as
`sync-tick.sh {fast|medium|slow|daily|weekly|all}`. Re-read the script itself
for the current, authoritative list — this is a summary, not a mirror:

- **`fast`** (every 5 min) — `refresh-trending` only (cheap, in-DB, no network).
- **`medium`** (every 15 min) — `sync-github-releases`, `refresh-radar`.
- **`slow`** (every 6 h) — `sync-cips`, `sync-cip-assets`, `sync-docs`,
  `sync-github-discussions`, `sync-github-items`, `sync-papers`,
  `sync-network-stats`, then `build-embeddings`.
- **`daily`** (03:15) — `sync-youtube` + transcripts, `sync-ecosystem`,
  `sync-foundation`, TL;DR backfill, doc enrichment, `build-embeddings`,
  vocab migration, then the full `check-*.ts` suite (dozens of scripts —
  `check-sql`, `check-completeness`, `check-citations`, `check-fencing`, and
  many more), finishing with `prune-logs`.
- **`weekly`** (Mondays 04:30) — `build-weekly-digest`, `backfill-cip-history`.
- **`all`** — every plain-fetch sync in one pass + embed; not on cron, run by
  hand for a first data load or a full backfill (`deploy/sync-tick.sh all`).

Each bucket takes an exclusive lock (see below), so overlapping runs of the
*same* bucket skip rather than stack; different buckets run concurrently.

`deploy/sync-cf.sh` is separate because `sync-forum` and `sync-blog` need a
real headful Chrome (Cloudflare's bot check rejects a plain fetch), so it
launches under `xvfb-run` on its own 30-minute cadence, then runs
`build-embeddings` itself afterward.

Every sync script is invoked as `npx tsx scripts/<name>.ts` — there is no
build step for any of this; editing a script under `scripts/` changes cron's
next run, live, with no restart.

## Logs

```bash
tail -f /var/log/yourpedia-sync.log        # sync-tick.sh + sync-cf.sh output
tail -f /var/log/yourpedia-staleness.log   # check-sync-staleness.sh output
```

Both files are plain `>>` appends with no rotation configured in the crontab
itself — `/var/log/yourpedia-sync.log` grows unbounded (it was already ~19 MB
at last check); rotate it externally (`logrotate` or a manual truncate) if
that becomes a problem, `sync-tick.sh` does not do this for you.

Each line is prefixed `[<bucket> <ISO-8601 timestamp>] <script> [ok|FAILED]`,
e.g.:

```
[slow 2026-09-02T18:00:03+00:00] sync-cips
[slow 2026-09-02T18:00:11+00:00] sync-cips ok
```

## Verifying a sync actually ran (and actually did something)

A script exiting 0 is not proof the data changed — query the `sync_log`
table it writes to instead:

```bash
export PATH=/root/.nvm/versions/node/v22.18.0/bin:$PATH
cd /srv/yourpedia
sqlite3 data/cips.db \
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
ls -la /run/yourpedia-sync-*.lock
```

A run that "should have happened" but didn't touch `sync_log` or the log file
usually means the *previous* run of that same bucket was still holding the
lock (a slow upstream fetch, a hung network call) — `sync-tick.sh` logs
`previous run still going, skip` in that case rather than queuing. `sync-cf.sh`
has its own separate lock, `/run/yourpedia-sync-cf.lock`. These are `/run`
(tmpfs), so they don't survive a reboot — that's intentional, a fresh boot
should never start up already "locked".

## Watchdog

`/usr/local/bin/yourpedia-watchdog.sh` runs every minute, independent of the
sync buckets:

```bash
curl -fs --max-time 10 http://127.0.0.1:3040/api/health >/dev/null 2>&1 || systemctl restart yourpedia
curl -fs --max-time 10 http://127.0.0.1:3041/health      >/dev/null 2>&1 || systemctl restart yourpedia-mcp
```

This restarts the **web app or MCP server process**, not a sync — it has
nothing to do with whether data is fresh, only whether the two services are
answering. Staleness (data not being refreshed) is a separate concern, caught
by `check-sync-staleness.sh` above, which reads `/api/metrics` on the live
site rather than querying the DB directly.

## Troubleshooting checklist

1. **Is cron even installed for this?** `sudo -n crontab -l -u root | grep yourpedia`
2. **Did the last run of a bucket complete?** `grep '\[daily ' /var/log/yourpedia-sync.log | tail -40`
3. **Did it write real rows, not just exit 0?** the `sync_log` query above —
   compare `ran_at` against "now"; a source stuck hours behind its bucket's
   cadence is the actual signal, not the log tail.
4. **Is a bucket stuck on its lock?** `ls -la /run/yourpedia-sync-*.lock` plus
   `ps aux | grep tsx` to see if something is still running under it.
5. **Root's git ownership.** `/srv/yourpedia/.git` is owned by `claude:claude`
   while cron runs sync scripts as root, which is exactly the setup where git
   normally refuses with `detected dubious ownership`. The one place this repo
   shells out to git (`mcp-server.ts`, resolving the running commit for
   `/api/health`) passes `-c safe.directory=<repo-root>` inline on that one
   call rather than relying on a pre-existing global git config — so there is
   nothing to configure once for cron's sake. If you add a sync script that
   shells out to `git` directly, give it the same inline flag rather than
   assuming a global `safe.directory` entry exists; `/srv/yourpedia` is not
   in root's `git config --global safe.directory` list.
6. **Wrong Node.** `sync-tick.sh` hardcodes
   `PATH=/root/.nvm/versions/node/v22.18.0/bin:...` at the top specifically so
   cron (which does not source a login shell / `.bashrc`) doesn't fall back to
   a system Node that can't load `better-sqlite3`. If you're reproducing a
   failure by hand, export that same PATH first or you'll "fix" something
   that was never broken under cron.
