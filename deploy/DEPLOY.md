# NEAR-pedia — deployment (do NOT run without explicit approval)

Shared VPS. Ports: **3130** (Next.js web + REST `/api/v1`), **3131** (MCP `/mcp`).
Node **v22** (`/root/.nvm/versions/node/v22.18.0`). Domain **nearpedia.example**.

## 1. Secrets
Create `/srv/nearpedia/.env.production` (chmod 600) from `.env.example`. Use keys
dedicated to this project. Minimum: `OPENAI_API_KEY`, `GROQ_API_KEY` (and/or `GEMINI_API_KEY`).
Recommended: `GITHUB_TOKEN` (5000 vs 60 req/h), `COHERE_API_KEY` (reranker),
`METRICS_TOKEN` (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
if anything outside the box scrapes `/api/metrics`.

## 2. Build (with Node v22)
```bash
cd /srv/nearpedia
export PATH=/root/.nvm/versions/node/v22.18.0/bin:$PATH
npm ci
npm run build
```

## 3. First data load
`npm run <sync:x>` only exists for a handful of sources (see `package.json`
`scripts`); everything else — and the exact set below — runs the way cron
runs it, `npx tsx scripts/<name>.ts`, per `deploy/sync-tick.sh`'s own `all`
bucket:
```bash
npm run db:init
deploy/sync-tick.sh all
```
which is equivalent to, and easier to keep in sync than retyping, this list:
```bash
for s in sync-docs sync-packages sync-repos sync-github-releases sync-protocol \
         sync-forum sync-hos refresh-radar sync-github-discussions sync-github-items \
         sync-network-stats sync-ecosystem sync-incidents sync-partner-docs \
         sync-site-docs sync-neps sync-blog sync-youtube; do npx tsx "scripts/$s.ts"; done
npx tsx scripts/build-embeddings.ts
```
Cloudflare-gated sources (forum, blog) are separate — they need a real headful
Chrome, not a plain fetch:
```bash
xvfb-run -a npx tsx scripts/sync-forum.ts
xvfb-run -a npx tsx scripts/sync-blog.ts
npx tsx scripts/build-embeddings.ts
```

## 4. systemd
```bash
cp deploy/nearpedia.service deploy/nearpedia-mcp.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now nearpedia nearpedia-mcp
journalctl -fu nearpedia
```

## 5. Caddy
Add `deploy/Caddyfile` block to the shared Caddyfile (set TLS / Cloudflare as
noted inside), then `caddy reload` (or `systemctl reload caddy`).

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
curl -s https://nearpedia.example/api/v1/sources        # via Caddy
```

## Release flow
Single branch (`main`), no release tags — confirmed by `git tag` (empty) and
this repo's own `CLAUDE.md` ("No release tags, no long-lived side branches.
Work directly on `main`"). The actual pattern in the commit history is:
feature branch → merge commit into `main` → build → `systemctl restart
nearpedia nearpedia-mcp` → post-deploy check. `main` **is** prod; there is no
separate tag-a-release step and nothing to check out for a "release" that
isn't just a commit on `main`. Origin (`git remote -v`) is already an HTTPS
URL, not SSH, but this box has no stored GitHub credentials for it, so a bare
`git push origin main` fails on auth. Push via `deploy/push-main.sh` instead —
it reads `GITHUB_TOKEN` from `.env.production`, embeds it into a one-off push
URL (redacted from all output), and then fetches into the `origin/main`
tracking ref afterward, which a raw authenticated push would not do on its
own and which is what keeps `git status` honest afterward. NEVER commit
straight to main without going through a branch + merge. NEVER deploy without
explicit go-ahead.
