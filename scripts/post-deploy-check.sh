#!/usr/bin/env bash
#
# NEAR-pedia — post-deploy smoke test.
#
# Run on the server after a deploy. Exits non-zero on any failure so it can be
# wired into a deploy script:
#
#   /srv/nearpedia/scripts/post-deploy-check.sh && echo "Deploy OK"
#
# WHICH SERVER IT ASKS. By default the box's own origin: https://nearpedia.example
# resolved to 127.0.0.1 (Caddy's Cloudflare Origin certificate is not publicly
# trusted, hence -k). The public host goes through Cloudflare, which answers a
# machine on this box with a 401 on /api/metrics, so a check that
# used it would report a defect the deploy did not cause.
#
# ONE RUN SPENDS 17 OF THE 120 REQUESTS /api/v1 ALLOWS PER 15 MINUTES for
# one address, and every local caller shares the address 127.0.0.1 (this script,
# check-endpoints, check-latency). Six runs in a quarter of an hour turn the REST
# checks into 429s, which are reported as rate limiting and not as a broken deploy.
#
# Env vars:
#   BASE_URL    another server to test (then no origin override is applied)
#   CURL_EXTRA  extra curl arguments, replacing the default origin override
#   TIMEOUT     curl timeout per request (default 15s)

set -euo pipefail

BASE="${BASE_URL:-https://nearpedia.example}"
TIMEOUT="${TIMEOUT:-15}"
if [[ -z "${BASE_URL:-}" && -z "${CURL_EXTRA+x}" ]]; then
  CURL_EXTRA="-k --resolve nearpedia.example:443:127.0.0.1"
fi
# shellcheck disable=SC2206  # word splitting is the point
CURL=(curl -sS -m "$TIMEOUT" ${CURL_EXTRA:-})

fail=0

check() {
  local name="$1" url="$2" expected_status="${3:-200}" want_substring="${4:-}"
  printf "  %-32s " "$name"
  local body status
  body=$("${CURL[@]}" -w "\n%{http_code}" "$url" 2>&1 || true)
  status=$(echo "$body" | tail -n1)
  body=$(echo "$body" | sed '$d')
  if [[ "$status" == "429" ]]; then
    echo "FAIL: HTTP 429, rate limited (this address has spent its /api/v1 budget; wait for the window to reset and rerun)"
    fail=$((fail + 1))
    return
  fi
  if [[ "$status" != "$expected_status" ]]; then
    echo "FAIL: HTTP $status (wanted $expected_status)"
    fail=$((fail + 1))
    return
  fi
  if [[ -n "$want_substring" ]] && ! grep -q -- "$want_substring" <<<"$body"; then
    echo "FAIL: body missing '$want_substring'"
    fail=$((fail + 1))
    return
  fi
  echo "ok"
}

# A page that moved on purpose must still answer with a redirect, not a 404.
check_redirect() {
  local name="$1" url="$2"
  printf "  %-32s " "$name"
  local status
  status=$("${CURL[@]}" -o /dev/null -w "%{http_code}" "$url" 2>&1 || true)
  if [[ "$status" =~ ^30[1278]$ ]]; then
    echo "ok ($status)"
  else
    echo "FAIL: HTTP $status (wanted a 301/302/307/308 redirect)"
    fail=$((fail + 1))
  fi
}

echo "=== Pages ==="
check "home"           "$BASE/"                                  200 "NEAR-pedia"
check "/discussions"   "$BASE/discussions"                       200
check "/docs"          "$BASE/docs"                              200
check "/for-ai"        "$BASE/for-ai"                            200 "MCP"
check "/radar"         "$BASE/radar"                             200
check "/blog"          "$BASE/blog"                              200
check "/releases"      "$BASE/releases"                          200
check "/ecosystem"     "$BASE/ecosystem"                         200
check "/sources"       "$BASE/sources"                           200
check "/videos"        "$BASE/videos"                            200
check "/search"        "$BASE/search"                            200
check "/privacy"       "$BASE/privacy"                           200
check "/terms"         "$BASE/terms"                             200
check "/contact"       "$BASE/contact"                           200
check "/security"      "$BASE/security"                          200 "Coordinated Disclosure"

echo "=== Redirects ==="
check_redirect "/news"       "$BASE/news"
check_redirect "/stats"      "$BASE/stats"
check_redirect "/developers" "$BASE/developers"
check_redirect "/proposals"  "$BASE/proposals"

echo "=== HTML structure ==="
check "home topbar"      "$BASE/"                                200 'NEAR-pedia'
check "home names NEAR" "$BASE/"                             200 'NEAR'
check "home FAQ schema"  "$BASE/"                                200 '"@type":"FAQPage"'
check "Skip link"        "$BASE/"                                200 'Skip to content'
check "JSON-LD home"     "$BASE/"                                200 'application/ld+json'

# Dynamic OG image generation: verify the per-route ImageResponse pipeline did
# not break. Probes Content-Type and byte length, since the body is a PNG.
probe_image() {
  local name="$1" url="$2" min_bytes="${3:-5000}"
  printf "  %-32s " "$name"
  local headers body_size content_type
  headers=$("${CURL[@]}" -I "$url" 2>&1 || true)
  content_type=$(echo "$headers" | grep -i '^content-type:' | head -1 | tr -d '\r' || true)
  body_size=$("${CURL[@]}" -L -o /dev/null -w "%{size_download}" "$url" 2>/dev/null || true)
  body_size="${body_size//[^0-9]/}"
  body_size="${body_size:-0}"
  if [[ "$content_type" != *image/png* ]]; then
    echo "FAIL: Content-Type '$content_type' (expected image/png)"
    fail=$((fail + 1))
    return
  fi
  if [[ "$body_size" -lt "$min_bytes" ]]; then
    echo "FAIL: only $body_size bytes (expected at least $min_bytes)"
    fail=$((fail + 1))
    return
  fi
  echo "ok ($body_size bytes)"
}

probe_image "root OG"             "$BASE/opengraph-image"

echo "=== APIs ==="
check "/api/health"    "$BASE/api/health"                        200 '"status"'
check "/api/metrics"   "$BASE/api/metrics"                       200 'nearpedia_docs_total'
check "metrics:search" "$BASE/api/metrics"                       200 'nearpedia_search_24h'
check "v1 pop searches" "$BASE/api/v1/searches/popular?limit=1"  200 '"items"'

check "/api/v1"        "$BASE/api/v1"                            200 "endpoints"
check "/api/v1/stats"  "$BASE/api/v1/stats"                      200 '"latest"'
check "/api/v1/search" "$BASE/api/v1/search?q=near&limit=1"       200 '"items"'
check "/api/v1/discussions"        "$BASE/api/v1/discussions?limit=1"        200
check "/api/v1/github-discussions" "$BASE/api/v1/github-discussions?limit=1" 200
check "/api/v1/network"            "$BASE/api/v1/network"                    200 '"chain"'
check "/api/v1/csp-violations"     "$BASE/api/v1/csp-violations?window=7"    200 '"items"'
check "/api/v1 sources"            "$BASE/api/v1/sources"                    200 '"source_count"'
check "/api/v1 changes"            "$BASE/api/v1/changes?days=30"            200 '"counts"'
check "/api/v1 openapi.json"       "$BASE/api/v1/openapi.json"               200 '"openapi"'

# Cache-Control on a stable read-only endpoint: agents that respect it hit the
# edge instead of the origin.
printf "  %-32s " "Cache-Control v1/sources"
cc=$("${CURL[@]}" -I "$BASE/api/v1/sources" 2>&1 | grep -i '^cache-control:' || true)
if echo "$cc" | grep -q 'max-age=300'; then echo "ok"; else echo "FAIL: missing max-age=300 on /api/v1/sources"; fail=$((fail + 1)); fi

echo "=== Feeds ==="
check "atom forum"      "$BASE/api/feed/forum"                   200 "<feed"
check "atom pulse"      "$BASE/api/feed/pulse"                   200 "<feed"
check "atom blog"       "$BASE/api/feed/blog"                    200 "<feed"
check "atom releases"   "$BASE/api/feed/releases"                200 "<feed"
check "atom gh-disc"    "$BASE/api/feed/github-discussions"      200 "<feed"

echo "=== SEO ==="
check "sitemap"        "$BASE/sitemap.xml"                       200 "<urlset"
check "robots"         "$BASE/robots.txt"                        200

# Sitemap depth: make sure the long tail is not silently truncated. The corpus
# was about 2,100 URLs on 2026-09-20; raise the floor when content grows.
printf "  %-32s " "sitemap URL count"
sitemap_count=$("${CURL[@]}" -m 30 "$BASE/sitemap.xml" 2>/dev/null | grep -c "<loc>" || true)
sitemap_count="${sitemap_count//[^0-9]/}"
sitemap_count="${sitemap_count:-0}"
if [[ "$sitemap_count" -ge 1500 ]]; then
  echo "ok ($sitemap_count URLs)"
else
  echo "FAIL: only $sitemap_count URLs (expected at least 1500)"
  fail=$((fail + 1))
fi

echo "=== PWA ==="
check "manifest"       "$BASE/manifest.webmanifest"              200 '"short_name"'
check "service worker" "$BASE/sw.js"                             200 'self.addEventListener'

echo "=== Security ==="
check "security.txt"   "$BASE/.well-known/security.txt"          200 'Contact:'

# Verify the security headers reach the wire (Caddy and Next can both set
# headers; this catches one of them dropping the other on a config typo).
printf "  %-32s " "CSP header (nonce-CSP)"
csp=$("${CURL[@]}" -I "$BASE/" 2>&1 | grep -i '^content-security-policy:' || true)
if [[ -z "$csp" ]]; then
  echo "FAIL: Content-Security-Policy missing"
  fail=$((fail + 1))
elif ! echo "$csp" | grep -q "nonce-"; then
  echo "FAIL: CSP present but no per-request nonce (middleware not running?)"
  fail=$((fail + 1))
elif ! echo "$csp" | grep -q "strict-dynamic"; then
  echo "FAIL: CSP nonce present but no 'strict-dynamic'"
  fail=$((fail + 1))
else
  echo "ok"
fi
printf "  %-32s " "HSTS header"
hsts=$("${CURL[@]}" -I "$BASE/" 2>&1 | grep -i '^strict-transport-security:' || true)
if [[ -n "$hsts" ]]; then
  echo "ok"
else
  echo "FAIL: Strict-Transport-Security missing"
  fail=$((fail + 1))
fi

echo
if [[ $fail -gt 0 ]]; then
  echo "Post-deploy check FAILED: $fail check(s) failed."
  exit 1
fi
echo "All checks passed."
