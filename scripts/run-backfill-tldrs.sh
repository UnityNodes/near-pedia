#!/usr/bin/env bash
set -euo pipefail
cd /srv/yourpedia
# Load env, but only KEY=VALUE pairs (skip blank lines + comments)
while IFS='=' read -r key val; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  export "$key"="$val"
done < .env.production
export PATH=/root/.nvm/versions/node/v22.18.0/bin:$PATH
exec npx tsx scripts/backfill-tldrs.ts
