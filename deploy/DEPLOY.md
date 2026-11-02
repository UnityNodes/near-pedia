# NEAR-pedia — deployment (do NOT run without explicit approval)

Shared VPS (<server IP>). Ports: **3130** (Next.js web), **3131** (MCP `/mcp`
and the REST API `/api/v1`). Node **v22** (`/root/.nvm/versions/node/v22.18.0`).
Domain **near-pedia.xyz**, behind Cloudflare like the other sites on this box.

## 0. Cloudflare (once, in the dashboard)
1. Add `near-pedia.xyz` to Cloudflare and set the registrar's nameservers to the two Cloudflare gives.
2. DNS: `A  @  <server IP>` and `CNAME  www  near-pedia.xyz`, both proxied (orange cloud).
3. SSL/TLS → Overview: **Full (strict)**.
4. SSL/TLS → Origin Server → Create Certificate for `near-pedia.xyz, *.near-pedia.xyz`.
   Put the certificate in `/etc/ssl/cf-origin-nearpedia.pem` and the private key in
   `/etc/ssl/cf-origin-nearpedia-key.pem` (chmod 600, owner root, readable by caddy as the
   other `cf-origin-*` files are). The key never goes into chat, git or a ticket.

## 1. Secrets
Create `/srv/nearpedia/.env.production` (chmod 600) from `.env.example`. Required:
`NEXT_PUBLIC_SITE_URL=https://near-pedia.xyz` (every canonical, sitemap and MCP link is
built from it) and `GITHUB_TOKEN` (5000 calls an hour instead of 60). `NEARAI_API_KEY`
turns on `/ask`, semantic search embeddings and the reranker. The `NEARPEDIA_ANCHOR_*`
variables record the daily database hash on NEAR (see CLAUDE.md).

## 2. Build (with Node v22)
```bash
cd /srv/nearpedia
export PATH=/root/.nvm/versions/node/v22.18.0/bin:$PATH
npm ci
npm run build
```

## 3. First data load
The same fill the README's judge path runs, every source read live (about 25
minutes, plus about 50 for embeddings with `NEARAI_API_KEY`):
```bash
npm run db:init
npm run sync:near
```
Forum posts beyond the newest 300 threads and video descriptions keep arriving on the
schedule (section 6); `FORUM_POST_TOPICS=3000 npx tsx scripts/sync-forum.ts` and
`YOUTUBE_BACKFILL=2000 npx tsx scripts/sync-youtube.ts` complete them in one go, then
`npx tsx scripts/build-embeddings.ts`.

## 4. systemd
```bash
cp deploy/nearpedia.service deploy/nearpedia-mcp.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now nearpedia nearpedia-mcp
journalctl -fu nearpedia
```

## 5. Caddy
Append the `deploy/Caddyfile` block to `/etc/caddy/Caddyfile` (it reads the origin
certificate from section 0), check it with `caddy validate --config /etc/caddy/Caddyfile`,
then `systemctl reload caddy`.

## 6. Cron (root crontab) + watchdog
Real crontab has more buckets than a minimal setup needs on day one (the weekly
full re-read, DB backup, a staleness check) —
see `docs/setup/CRON_SETUP.md` for the full list and how to verify it's
running. Minimum to get syncs flowing:
```
*/5  * * * * /srv/nearpedia/deploy/sync-tick.sh fast   >> /var/log/nearpedia-sync.log 2>&1
*/15 * * * * /srv/nearpedia/deploy/sync-tick.sh medium >> /var/log/nearpedia-sync.log 2>&1
0 */6 * * *  /srv/nearpedia/deploy/sync-tick.sh slow   >> /var/log/nearpedia-sync.log 2>&1
15 3 * * *   /srv/nearpedia/deploy/sync-tick.sh daily  >> /var/log/nearpedia-sync.log 2>&1
30 4 * * 1   /srv/nearpedia/deploy/sync-tick.sh weekly >> /var/log/nearpedia-sync.log 2>&1
* * * * *    /usr/local/bin/nearpedia-watchdog.sh
```
The watchdog is its own script, not an inline curl — it checks *both* ports:
```bash
#!/usr/bin/env bash
curl -fs --max-time 10 http://127.0.0.1:3130/api/health >/dev/null 2>&1 || systemctl restart nearpedia
curl -fs --max-time 10 http://127.0.0.1:3131/health      >/dev/null 2>&1 || systemctl restart nearpedia-mcp
```

## 7. Post-deploy check
```bash
curl -s http://127.0.0.1:3130/api/health            # live counts, status ok (NOT /api/v1/health — that path 404s)
curl -s http://127.0.0.1:3131/health                # MCP up
curl -s https://near-pedia.xyz/api/v1/sources        # via Caddy
```

## Release flow
Feature branch → checked → merged into `main` → build → `systemctl restart
nearpedia nearpedia-mcp` → post-deploy check (section 7). Tags: `pre-hackathon`
is the baseline (never moved), release snapshots on `main` are semver tags
(`git tag --sort=-v:refname | head -1` gives the latest). Push through
`deploy/push-main.sh`, which reads `GITHUB_TOKEN` from `.env.production` for a
one-off authenticated push and keeps it out of the output. Nothing is pushed,
deployed or restarted without an explicit go from the maintainers.
