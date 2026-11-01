/**
 * Files YOURPEDIA shares with the reskin template, byte for byte.
 *
 * WHY THIS EXISTS. `your-org/pedia-template` (see RESKIN.md) is a full copy
 * of this app, not a library it depends on, so a fix made here reaches the
 * template, and any OTHER product built from it, only if somebody remembers
 * to port it by hand. Nobody reliably does: a template-drift check once
 * found a template 338 commits behind and still shipping the
 * fail-open rate limit and both INSERT OR REPLACE wipes this repo's own
 * 2026-08-01/02 audits found and fixed independently, in the same lines.
 *
 * Porting once does not fix that; it resets the clock. What fixes it is that
 * drift becomes loud: scripts/check-template.ts compares every path below
 * against the template on GitHub and fails when they differ.
 *
 * WHAT BELONGS HERE. Only files with no product knowledge in them: no table
 * names, no endpoint lists, no YourChain vocabulary that changes meaning in
 * another domain. A file that needs adapting per product is not shared, it
 * is copied once and diverges honestly, which is a smaller lie than
 * pretending it is common.
 *
 * A FIRST RUN CAN SHOW "drifted" HONESTLY. This manifest was written by
 * comparing shapes and purposes, not by
 * fetching the template repo first - the check itself is the thing that
 * fetches it. tests/setup.ts in particular is expected to differ in its
 * CREDENTIAL_PATTERNS array: yourpedia's real env vars (TELEGRAM_,
 * DISCORD_, GITHUB_) differ from other products' env vars, so
 * an identical file would be wrong for one product or the other. That is
 * real, permanent, correct divergence, not drift - keep it in the manifest
 * anyway so the STRUCTURE (network block, wipe-by-pattern-not-enumeration)
 * stays comparable, but read a "drifted" result on that one file for what
 * it actually is before treating it as a finding.
 *
 * DELIBERATELY ABSENT, and why, so nobody adds them by reflex:
 *
 *   lib/db.ts                The schema IS the product.
 *   mcp-server.ts             Same.
 *   deploy/sync-tick.sh       The buckets are per-product; only the SHAPE
 *                             is common, and a shape cannot be diffed.
 *   scripts/check-scheduled.ts    Generic mechanism, product-specific
 *                             MANUAL map.
 *   scripts/check-sources.ts      Generic mechanism, product-specific
 *                             NOT_A_SOURCE map.
 *   scripts/check-completeness.ts Per-source upstream counts throughout.
 *   lib/api-endpoints.ts      The published REST inventory, per product.
 *   app/api/contact/route.ts  Shares the rate-limit shape, not the handler.
 *   tsconfig.scripts.json     A product whose main tsconfig excludes scripts/
 *                             needs a second one; yourpedia's
 *                             main tsconfig.json already covers scripts/
 *                             (see CLAUDE.md), so a second file here would
 *                             be a real, permanent, correct absence - not
 *                             a gap to close.
 *
 * Each is worth copying by hand into a new product and then editing.
 * They are listed here rather than nowhere so the decision is visible.
 */

export interface TemplateFile {
  /** Repo-relative path, identical on both sides. */
  path: string;
  /** What it is, and what breaks in a product that lacks it. */
  why: string;
  /**
   * Substitutions applied to THIS repo's copy before it is compared, for a file
   * that differs from the template only by a product name. The comparison stays
   * byte-exact once the names are mapped back, so real drift is still caught.
   */
  rename?: Array<[string, string]>;
  /**
   * A file that legitimately differs by more than names. It is not compared, and
   * the reason is printed on every run so it stays a visible decision and not a
   * silent skip.
   */
  diverges?: string;
}

export const TEMPLATE_FILES: TemplateFile[] = [
  {
    path: 'lib/prune.ts',
    why: 'Shared delete-what-upstream-dropped helper with a non-empty AND a ratio guard. Without both, a sync only ever inserts, or a truncated fetch reads as a mass unpublish.',
  },
  {
    path: 'lib/is-entrypoint.ts',
    why: 'Tells a script whether it was run or merely imported. Without it, a script with a top-level side effect fires on import - discovered here 2026-08-02 when importing a sync script for a shared constant ran the whole sync against the live database.',
  },
  {
    path: 'lib/untrusted-fence.ts',
    why: 'The fence public, attacker-writable text (forum posts, GitHub Discussion comments) gets before it reaches an LLM context. Missing entirely until this pass, so retrieved chunks went straight into the model with no fencing at all.',
  },
  {
    path: 'lib/sync-log.ts',
    why: 'recordSync/withSyncLog: how a sync reports its own failure. Without it, a long outage looks exactly like a quiet week.',
  },
  {
    path: 'lib/user-agent-classify.ts',
    why: 'Bot/human classification, no_ua vs unknown distinguished. An older shape that merged them let a request with no User-Agent header read as human in visitor counts.',
  },
  {
    path: 'lib/rate-limit.ts',
    why: 'Client IP identification (X-Real-IP, then CF-Connecting-IP, then X-Forwarded-For), used by the contact form and the TL;DR endpoint limiter.',
    diverges: 'the chat limiter (checkRateLimit, recordRequest, validateMessage, cleanupOldRecords) and the cookie and fingerprint identifiers were removed here together with the chat feature, so this copy keeps only getIdentifiers. The template copy is not changed by that removal.',
  },
  {
    path: 'tests/setup.ts',
    why: 'Stops the test suite firing real emails, webhooks and API calls. Was a one-line no-op here until 2026-08-01. See the note above on why CREDENTIAL_PATTERNS legitimately differs per product.',
  },
  {
    path: 'scripts/check-sql.ts',
    why: 'Compiles every serving-layer SQL statement against the real schema. Found 6 real bugs here on its first run, including a metrics gauge that had reported 0% tldr coverage forever via a double-quoted-string SQLite misfeature.',
    diverges: 'the checker is shared but its exception maps (honest clock sorts, LIKE exceptions) name each product\'s own files and columns. Another product\'s copy run here fails on 4 exceptions that point at tables this product does not have. Moving the maps into a per-product data file would make the code byte-identical; until then the two copies are reconciled by hand.',
  },
  {
    path: 'lib/strip-comments.ts',
    why: 'check-sql.ts above imports stripJsComments from here. Present and identical to the template, but missing from this list until 2026-09-02 - a product that synced check-sql.ts alone from this manifest would have gotten a file that could not compile.',
  },
  {
    path: 'scripts/backup-db.sh',
    why: 'WAL-safe snapshot with retention, configured by env. Reads its own DB path and backup dir from the environment, so it is identical everywhere it is used correctly.',
  },
  {
    path: 'deploy/push-main.sh',
    why: 'Push wrapper that also updates the tracking ref, redacts the token and refuses to run dirty. Reads its own repo and remote, so it is identical everywhere. Built here after this manifest first said yourpedia lacked it - present and identical since, just never added to this list until 2026-09-02.',
  },
];
