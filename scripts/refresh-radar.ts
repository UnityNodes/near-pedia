import { getDb } from '../lib/db';
import { guardSync } from '../lib/sync-log';
import { SITE } from '../lib/site.config';

type Level = 'critical' | 'important' | 'ecosystem';

interface RadarCandidate {
  sourceType: string;
  sourceId: string;
  title: string;
  body: string;
  url: string;
  publishedAt: string;
  level: Level;
  affects: string[];
  deadline: string | null;
}

// ── Keyword sets ────────────────────────────────────────────────────────────

// Forum category ids on forum.yourchain.example. The NEAR originals (56, 58) do
// not exist here - both branches matched zero rows, so radar was running on
// releases and CIP transitions alone with no forum signal at all.
//   operational: where an upgrade, parameter change or deadline is announced
//   ecosystem:   where launches, grants and integrations are discussed
const OPERATIONAL_CATEGORIES = [14, 13, 32]; // Validators, Node Operators, Parameter Updates
const ECOSYSTEM_CATEGORIES = [22, 23];       // Ecosystem, Community

const CRITICAL_RE = /breaking.change|mandatory|must.upgrade|action.required|critical.upgrade|upgrade.required|immediately|urgent|before\s+\w+\s+\d+|deadline/i;
const DEADLINE_RE = /(?:by|before|until|no.later.than)\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?|\d{4}-\d{2}-\d{2})/gi;

function extractDeadline(text: string): string | null {
  DEADLINE_RE.lastIndex = 0;
  const m = DEADLINE_RE.exec(text);
  return m ? m[1].trim() : null;
}

// Audience tags for NEAR.
function detectAffects(text: string): string[] {
  const t = text.toLowerCase();
  const out = new Set<string>();
  if (/\bvalidator\b|\bstaking\b|\bconsensus\b/.test(t)) out.add('validator');
  if (/\bfull node\b|\barchive node\b|\bnode operator\b|yourchain-node/.test(t)) out.add('node-operator');
  if (/\bapplication\b|\byoursdk\b|\bcontract\b|\bdapp\b/.test(t)) out.add('rollup-dev');
  if (/\bdeveloper\b|\bsdk\b|\bapi\b|\brpc\b/.test(t)) out.add('developer');
  return [...out];
}

function classifyFromKeywords(text: string, baseLevel: Level): Level {
  if (CRITICAL_RE.test(text)) return 'critical';
  return baseLevel;
}

// ── Source processors ───────────────────────────────────────────────────────

function processForumAnnouncements(db: ReturnType<typeof getDb>, since: string): RadarCandidate[] {
  const rows = db.prepare(`
    SELECT id, title, last_post_at, url FROM forum_topics
    WHERE category_id IN (${OPERATIONAL_CATEGORIES.join(',')}) AND last_post_at > ?
    ORDER BY last_post_at DESC LIMIT 100
  `).all(since) as Array<{ id: number; title: string; last_post_at: string; url: string | null }>;

  return rows.map(r => {
    const text = r.title;
    const level = classifyFromKeywords(text, 'important');
    return {
      sourceType: 'forum_announcement',
      sourceId: String(r.id),
      title: r.title,
      body: '',
      url: r.url ?? `https://forum.yourchain.example/t/${r.id}`,
      publishedAt: r.last_post_at,
      level,
      affects: detectAffects(text),
      deadline: extractDeadline(text),
    };
  });
}

function processForumOutreach(db: ReturnType<typeof getDb>, since: string): RadarCandidate[] {
  const rows = db.prepare(`
    SELECT id, title, last_post_at, url FROM forum_topics
    WHERE category_id IN (${ECOSYSTEM_CATEGORIES.join(',')}) AND last_post_at > ?
      AND (
        title LIKE '%grant%' OR title LIKE '%CIP%'
        OR title LIKE '%governance%' OR title LIKE '%vote%'
        OR title LIKE '%proposal%' OR title LIKE '%launch%'
        OR title LIKE '%partner%' OR title LIKE '%integrat%'
        OR title LIKE '%ecosystem%' OR title LIKE '%new app%'
        OR title LIKE '%mainnet%' OR title LIKE '%approved%'
      )
      AND title NOT LIKE '%balance 0%'
      AND title NOT LIKE '%help%'
      AND title NOT LIKE '%issue%'
      AND title NOT LIKE '%error%'
      AND title NOT LIKE '%problem%'
    ORDER BY last_post_at DESC LIMIT 50
  `).all(since) as Array<{ id: number; title: string; last_post_at: string; url: string | null }>;

  return rows.map(r => ({
    sourceType: 'forum_ecosystem',
    sourceId: String(r.id),
    title: r.title,
    body: '',
    url: r.url ?? `https://forum.yourchain.example/t/${r.id}`,
    publishedAt: r.last_post_at,
    level: 'ecosystem' as Level,
    affects: detectAffects(r.title),
    deadline: null,
  }));
}

function processCipChanges(db: ReturnType<typeof getDb>, since: string): RadarCandidate[] {
  const rows = db.prepare(`
    SELECT h.cip_id, c.cip_number, c.title, c.type, h.from_status, h.to_status, h.changed_at
    FROM cip_status_history h LEFT JOIN cips c ON c.id = h.cip_id
    WHERE h.changed_at > ?
    ORDER BY h.changed_at DESC LIMIT 50
  `).all(since) as Array<{ cip_id: string; cip_number: number | null; title: string | null; type: string | null; from_status: string | null; to_status: string; changed_at: string }>;

  return rows.map(r => {
    const cipLabel = `CIP-${String(r.cip_number ?? r.cip_id).padStart(4, '0')}`;
    const title = `${cipLabel}: ${r.title ?? 'Untitled'} - ${r.from_status ?? '-'} → ${r.to_status}`;
    let level: Level = 'ecosystem';
    if (['Final', 'Active'].includes(r.to_status) && r.type === 'Standards Track') level = 'important';
    else if (r.to_status === 'In Review') level = 'important';
    else if (r.to_status === 'Rejected' || r.to_status === 'Withdrawn') level = 'ecosystem';
    return {
      sourceType: 'cip_change',
      sourceId: `${r.cip_id}:${r.to_status}`,
      title,
      body: '',
      url: `${SITE.url}/cips/${r.cip_id}`,
      publishedAt: r.changed_at,
      level,
      affects: detectAffects(r.title ?? ''),
      deadline: null,
    };
  });
}

function processGithubReleases(db: ReturnType<typeof getDb>, since: string): RadarCandidate[] {
  const rows = db.prepare(`
    SELECT id, repo, tag, name, body, published_at, url FROM github_releases
    WHERE published_at > ?
      AND tag NOT LIKE '%-snapshot%'
      AND tag NOT LIKE '%-rc%'
    ORDER BY published_at DESC LIMIT 50
  `).all(since) as Array<{ id: string; repo: string; tag: string; name: string | null; body: string | null; published_at: string | null; url: string }>;

  return rows.map(r => {
    const text = `${r.name ?? ''} ${r.body ?? ''}`;
    const level = classifyFromKeywords(text, 'important');
    return {
      sourceType: 'github_release',
      sourceId: r.id,
      title: `${r.repo.split('/')[1]} ${r.tag}${r.name && r.name !== r.tag ? ': ' + r.name : ''}`,
      body: r.body?.slice(0, 500) ?? '',
      url: r.url,
      publishedAt: r.published_at ?? new Date().toISOString(),
      level,
      affects: detectAffects(text),
      deadline: extractDeadline(text),
    };
  });
}

function processGithubBreaking(db: ReturnType<typeof getDb>, since: string): RadarCandidate[] {
  const rows = db.prepare(`
    SELECT id, type, repo, number, title, body, labels, created_at, url FROM github_items
    WHERE created_at > ?
      AND title NOT LIKE 'Bump %'
      AND title NOT LIKE '[ci]%'
      AND title NOT LIKE 'chore(deps)%'
      AND (
        body LIKE '%breaking change%'
        OR body LIKE '%mandatory%'
        OR body LIKE '%must upgrade%'
      )
    ORDER BY created_at DESC LIMIT 30
  `).all(since) as Array<{ id: string; type: string; repo: string; number: number | null; title: string; body: string | null; labels: string | null; created_at: string | null; url: string }>;

  return rows.map(r => {
    const text = `${r.title} ${r.body?.slice(0, 500) ?? ''}`;
    // An open issue is a discussion, not an announcement: "Breaking change to
    // the state" showing up in a proposal's Cons list is someone weighing a
    // trade-off, not a warning to operators. Treat the signal as deliberate
    // only when a human put it in the title or a label; a match buried in a
    // long body is a heads-up, not an alarm.
    const deliberate =
      CRITICAL_RE.test(r.title) || /breaking|mandatory/i.test(r.labels ?? '');
    return {
      sourceType: 'github_issue',
      sourceId: r.id,
      title: `[${r.repo.split('/')[1]} #${r.number}] ${r.title}`,
      body: r.body?.slice(0, 300) ?? '',
      url: r.url,
      publishedAt: r.created_at ?? new Date().toISOString(),
      level: (deliberate ? 'critical' : 'important') as Level,
      affects: detectAffects(text),
      deadline: extractDeadline(text),
    };
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(): number {
const db = getDb();
const since = new Date(Date.now() - 30 * 86400_000).toISOString();
const now = new Date().toISOString();

const upsert = db.prepare(`
  INSERT INTO radar_items (level, title, body, source_type, source_id, source_url, affects, deadline, published_at, expires_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_type, source_id) DO UPDATE SET
    level = excluded.level,
    title = excluded.title,
    body = excluded.body,
    affects = excluded.affects,
    deadline = excluded.deadline
`);

const candidates: RadarCandidate[] = [
  ...processForumAnnouncements(db, since),
  ...processForumOutreach(db, since),
  ...processCipChanges(db, since),
  ...processGithubReleases(db, since),
  ...processGithubBreaking(db, since),
];

let inserted = 0;
let updated = 0;
const counts = { critical: 0, important: 0, ecosystem: 0 };

for (const c of candidates) {
  const expires = c.level === 'critical'
    ? new Date(Date.now() + 30 * 86400_000).toISOString()
    : new Date(Date.now() + 90 * 86400_000).toISOString();

  const before = db.prepare('SELECT id FROM radar_items WHERE source_type=? AND source_id=?').get(c.sourceType, c.sourceId);
  upsert.run(
    c.level, c.title, c.body, c.sourceType, c.sourceId,
    c.url, JSON.stringify(c.affects), c.deadline,
    c.publishedAt, expires, now,
  );
  if (before) updated++; else inserted++;
  counts[c.level]++;
}

console.log(`[refresh-radar] inserted=${inserted} updated=${updated} critical=${counts.critical} important=${counts.important} ecosystem=${counts.ecosystem}`);
  return inserted + updated;
}

// Was a bare top-level script: recordSync('success', ...) ran unconditionally
// with nothing to catch a throw earlier in the file, so a crash left no
// sync_log row at all - indistinguishable from "hasn't run yet" to the
// staleness watchdog. check-scheduled.ts's UNGUARDED check exists for
// exactly this shape - guardSync is the fix it's checking for.
guardSync('radar', main).catch(e => { console.error(e); process.exitCode = 1; });
