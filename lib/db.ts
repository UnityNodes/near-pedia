import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as sqliteVec from 'sqlite-vec';
import { initNearSchema } from './near-schema';
import { DIMENSIONS } from './embedding-dims';

// The default database is resolved from this module's own location, not from
// process.cwd(). A cwd-relative default means code from one checkout silently
// opens another checkout's database: a sync script that resolves both its DB
// and its child scripts from cwd, run with cwd set to a sibling checkout,
// opened that checkout's database and spawned its sync-all.ts - which
// injected foreign rows and four foreign sync_log sources.
// Walking up to the package that owns this file pins nearpedia code to
// nearpedia's data no matter where it was invoked from.
//
// The walk falls back to cwd when this file has no real path on disk (a bundled
// server build), which is also the case where cwd is already correct because
// systemd sets WorkingDirectory. DB_PATH still overrides everything - that is
// the documented way to trial a destructive sync against a .backup copy.
function ownRepoRoot(): string {
  let dir: string;
  try {
    dir = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.name === 'nearpedia') return dir;
    } catch { /* not this level - keep walking up */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const DB_PATH = process.env.DB_PATH === ':memory:'
  ? ':memory:'
  : (process.env.DB_PATH && process.env.DB_PATH !== ':memory:' ? process.env.DB_PATH : path.join(ownRepoRoot(), 'data', 'nearpedia.db'));

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  // A closed handle used to be handed back forever. Any script that ends with
  // db.close() left every later caller in the same process holding a dead
  // connection, and the failure surfaced far from the close as "The database
  // connection is not open". Reopen instead.
  if (_db && !_db.open) _db = null;
  if (_db) return _db;

  if (DB_PATH !== ':memory:') {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }

  try {
    _db = new Database(DB_PATH);
    try {
      sqliteVec.load(_db);
    } catch {
      // sqlite-vec not available - vector search disabled
    }
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    // Cron syncs + the live app + the embed job all write to one SQLite file.
    // Without a busy timeout, a write collision throws SQLITE_BUSY immediately
    // (a sync or request fails). Wait up to 5s for the writer lock instead.
    _db.pragma('busy_timeout = 5000');
    initSchema(_db);
  } catch (err) {
    _db = null;
    throw new Error(`Failed to initialize database: ${err}`);
  }

  return _db;
}

export function resetDb(): void {
  if (process.env.NODE_ENV !== 'test' && process.env.DB_PATH !== ':memory:') {
    throw new Error('resetDb() is only allowed in test environment');
  }
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function initSchema(db: Database.Database = getDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS forum_topics (
      id INTEGER PRIMARY KEY,
      title TEXT,
      category_id INTEGER,
      created_at TEXT,
      last_post_at TEXT,
      posts_count INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      last_poster_username TEXT,
      url TEXT,
      synced_at TEXT,
      posts_synced_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_forum_topics_last_post_at ON forum_topics(last_post_at DESC);
    CREATE INDEX IF NOT EXISTS idx_forum_topics_category ON forum_topics(category_id);

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      slug TEXT,
      topic_count INTEGER DEFAULT 0,
      synced_at TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS forum_fts USING fts5(
      title,
      content='forum_topics',
      content_rowid='id'
    );

    CREATE TABLE IF NOT EXISTS forum_posts (
      id INTEGER PRIMARY KEY,
      topic_id INTEGER NOT NULL REFERENCES forum_topics(id),
      post_number INTEGER NOT NULL,
      username TEXT,
      created_at TEXT,
      cooked TEXT,
      like_count INTEGER DEFAULT 0,
      synced_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_forum_posts_topic ON forum_posts(topic_id, post_number);

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT,
      status TEXT,
      items_synced INTEGER,
      ran_at TEXT
    );

    CREATE TABLE IF NOT EXISTS doc_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      title TEXT,
      breadcrumb TEXT,
      excerpt TEXT,
      content_text TEXT,
      content_html TEXT,
      source TEXT NOT NULL,
      last_modified TEXT,
      synced_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_doc_pages_source ON doc_pages(source);

    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
      title,
      breadcrumb,
      content_text,
      content='doc_pages',
      content_rowid='id'
    );

    CREATE TABLE IF NOT EXISTS youtube_videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      published_at TEXT,
      url TEXT NOT NULL,
      thumbnail_url TEXT,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS github_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      repo TEXT NOT NULL,
      number INTEGER,
      title TEXT NOT NULL,
      body TEXT,
      state TEXT,
      author TEXT,
      created_at TEXT,
      url TEXT NOT NULL,
      labels TEXT,
      board_status TEXT,
      synced_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_github_items_type ON github_items(type);
    CREATE INDEX IF NOT EXISTS idx_github_items_repo ON github_items(repo);
    CREATE INDEX IF NOT EXISTS idx_github_items_board_status ON github_items(board_status);

    CREATE TABLE IF NOT EXISTS blog_posts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      excerpt TEXT,
      content_text TEXT,
      content_html TEXT,
      author TEXT,
      published_at TEXT,
      url TEXT NOT NULL UNIQUE,
      tags TEXT,
      synced_at TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS blog_posts_fts USING fts5(
      title,
      excerpt,
      content_text,
      content='blog_posts',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS youtube_videos_fts USING fts5(
      title,
      description,
      transcript_text,
      content='youtube_videos',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );
  `);

  const docCols = (db.pragma('table_info(doc_pages)') as { name: string }[]).map(c => c.name);
  if (!docCols.includes('content_html')) {
    db.exec('ALTER TABLE doc_pages ADD COLUMN content_html TEXT');
  }
  if (!docCols.includes('environment')) {
    db.exec('ALTER TABLE doc_pages ADD COLUMN environment TEXT');
    db.exec(`
      UPDATE doc_pages SET environment =
        CASE
          WHEN url LIKE '%/devnet/%' THEN 'devnet'
          WHEN url LIKE '%/testnet/%' THEN 'testnet'
          WHEN url LIKE '%/mainnet/%' THEN 'mainnet'
          WHEN url LIKE '%/releases/%' THEN 'releases'
          ELSE NULL
        END
    `);
  }

  const existingCols = (db.pragma('table_info(forum_topics)') as { name: string }[]).map(c => c.name);
  const newCols: [string, string][] = [
    ['reply_count', 'INTEGER DEFAULT 0'],
    ['views', 'INTEGER DEFAULT 0'],
    ['like_count', 'INTEGER DEFAULT 0'],
    ['last_poster_username', 'TEXT'],
    ['posts_synced_at', 'TEXT'],
  ];
  for (const [col, def] of newCols) {
    if (!existingCols.includes(col)) {
      db.exec(`ALTER TABLE forum_topics ADD COLUMN ${col} ${def}`);
    }
  }

  const blogCols = (db.pragma('table_info(blog_posts)') as { name: string }[]).map(c => c.name);
  if (!blogCols.includes('content_html')) {
    db.exec('ALTER TABLE blog_posts ADD COLUMN content_html TEXT');
  }

  const ytCols = (db.pragma('table_info(youtube_videos)') as { name: string }[]).map(c => c.name);
  if (!ytCols.includes('channel_name')) {
    db.exec('ALTER TABLE youtube_videos ADD COLUMN channel_name TEXT');
  }

  // youtube_videos_fts migration: legacy version indexed only title+description.
  // Detect via PRAGMA table_info: if transcript_text isn't there, drop the old
  // virtual table and recreate it with 3 columns. (The CREATE VIRTUAL TABLE
  // IF NOT EXISTS higher up already ran when the legacy table still existed,
  // so it was a no-op - we have to CREATE here explicitly after DROP.)
  // Triggers get re-created later in this function, after this migration.
  try {
    const ytFtsCols = (db.pragma('table_info(youtube_videos_fts)') as { name: string }[]).map(c => c.name);
    if (ytFtsCols.length > 0 && !ytFtsCols.includes('transcript_text')) {
      db.exec(`
        DROP TRIGGER IF EXISTS youtube_videos_fts_ai;
        DROP TRIGGER IF EXISTS youtube_videos_fts_ad;
        DROP TRIGGER IF EXISTS youtube_videos_fts_au;
        DROP TABLE youtube_videos_fts;
        CREATE VIRTUAL TABLE youtube_videos_fts USING fts5(
          title, description, transcript_text,
          content='youtube_videos', content_rowid='rowid', tokenize='porter unicode61'
        );
        INSERT INTO youtube_videos_fts(youtube_videos_fts) VALUES('rebuild');
      `);
    }
  } catch { /* table didn't exist yet */ }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS embedding_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      UNIQUE(source_type, source_id, chunk_index)
    )
  `).run();

  // Per-source content hash. Lets build-embeddings detect when a source
  // document's text changed since it was last embedded, so it can drop the
  // stale chunks/vectors and re-embed. Without this, embedding_chunks is
  // append-only (INSERT OR IGNORE) and edits never propagate to the vectors.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS embedding_doc_hash (
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (source_type, source_id)
    )
  `).run();

  const vec = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='embedding_vectors'"
  ).get() as { sql: string } | undefined;
  const vecWidth = vec ? Number(/FLOAT\[(\d+)\]/i.exec(vec.sql)?.[1]) : null;
  const noChunks = () => (db.prepare('SELECT COUNT(*) n FROM embedding_chunks').get() as { n: number }).n === 0;
  if (!vec || (vecWidth !== DIMENSIONS && noChunks())) {
    try {
      if (vec) db.prepare('DROP TABLE embedding_vectors').run();
      db.prepare(`CREATE VIRTUAL TABLE embedding_vectors USING vec0(embedding FLOAT[${DIMENSIONS}])`).run();
    } catch {
      // sqlite-vec extension not loaded
    }
  }

  // FTS5 mirror of embedding_chunks for hybrid search
  db.prepare(`
    CREATE VIRTUAL TABLE IF NOT EXISTS embedding_chunks_fts USING fts5(
      chunk_text,
      content='embedding_chunks',
      content_rowid='id',
      tokenize='porter unicode61'
    )
  `).run();

  // Triggers to keep FTS in sync with embedding_chunks
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS embedding_chunks_ai AFTER INSERT ON embedding_chunks BEGIN
      INSERT INTO embedding_chunks_fts(rowid, chunk_text) VALUES (new.id, new.chunk_text);
    END;
    CREATE TRIGGER IF NOT EXISTS embedding_chunks_ad AFTER DELETE ON embedding_chunks BEGIN
      INSERT INTO embedding_chunks_fts(embedding_chunks_fts, rowid, chunk_text) VALUES('delete', old.id, old.chunk_text);
    END;
    CREATE TRIGGER IF NOT EXISTS embedding_chunks_au AFTER UPDATE ON embedding_chunks BEGIN
      INSERT INTO embedding_chunks_fts(embedding_chunks_fts, rowid, chunk_text) VALUES('delete', old.id, old.chunk_text);
      INSERT INTO embedding_chunks_fts(rowid, chunk_text) VALUES (new.id, new.chunk_text);
    END;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS failure_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      surface TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('failed', 'degraded', 'rejected')),
      detail TEXT,
      caller TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_failure_events_at ON failure_events(at);
    CREATE TABLE IF NOT EXISTS alert_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  runMigrations(db);
  initNearSchema(db);
}

function runMigrations(db: Database.Database): void {
  // radar_items table
  db.prepare(`CREATE TABLE IF NOT EXISTS radar_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL CHECK(level IN ('critical','important','ecosystem')),
    title TEXT NOT NULL,
    body TEXT,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_url TEXT,
    affects TEXT DEFAULT '[]',
    deadline TEXT,
    published_at TEXT NOT NULL,
    expires_at TEXT,
    tg_sent INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(source_type, source_id)
  )`).run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_level ON radar_items(level, published_at DESC)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_published ON radar_items(published_at DESC)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_radar_tg ON radar_items(tg_sent, level)").run();

  // github_releases table
  db.prepare(`CREATE TABLE IF NOT EXISTS github_releases (
    id TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    tag TEXT NOT NULL,
    name TEXT,
    body TEXT,
    published_at TEXT,
    url TEXT NOT NULL,
    synced_at TEXT,
    prerelease INTEGER
  )`).run();
  // Existing DBs predate the prerelease column; CREATE TABLE IF NOT EXISTS
  // won't add it. GitHub's own flag - a tag can look stable and still be
  // marked prerelease=1 (or the reverse) - is the signal a tag-only stability
  // check cannot see, which is exactly the class scripts/check-release-
  // stability.ts exists to catch.
  {
    const cols = db.prepare('PRAGMA table_info(github_releases)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'prerelease')) {
      db.exec('ALTER TABLE github_releases ADD COLUMN prerelease INTEGER');
    }
  }
  db.prepare("CREATE INDEX IF NOT EXISTS idx_releases_repo ON github_releases(repo, published_at DESC)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_releases_published ON github_releases(published_at DESC)").run();

  // Migration: add board_status column to github_items if missing (for DBs created before 2026-05-09)
  const cols = db.prepare("PRAGMA table_info(github_items)").all() as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some(c => c.name === 'board_status')) {
    db.prepare("ALTER TABLE github_items ADD COLUMN board_status TEXT").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_github_items_board_status ON github_items(board_status)").run();
  }
  // Backfill FTS index if it's empty but chunks exist (existing DB upgrade path)
  try {
    const ftsCount = db.prepare("SELECT COUNT(*) as c FROM embedding_chunks_fts").get() as { c: number };
    const chunkCount = db.prepare("SELECT COUNT(*) as c FROM embedding_chunks").get() as { c: number };
    if (chunkCount.c > 0 && ftsCount.c === 0) {
      db.prepare("INSERT INTO embedding_chunks_fts(embedding_chunks_fts) VALUES('rebuild')").run();
    }
  } catch {
    // FTS table missing in old DB - will be created on next initSchema run
  }

  // FTS triggers for blog_posts
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS blog_posts_fts_ai AFTER INSERT ON blog_posts BEGIN
      INSERT INTO blog_posts_fts(rowid, title, excerpt, content_text) VALUES (new.rowid, new.title, new.excerpt, new.content_text);
    END;
    CREATE TRIGGER IF NOT EXISTS blog_posts_fts_ad AFTER DELETE ON blog_posts BEGIN
      INSERT INTO blog_posts_fts(blog_posts_fts, rowid, title, excerpt, content_text) VALUES('delete', old.rowid, old.title, old.excerpt, old.content_text);
    END;
    CREATE TRIGGER IF NOT EXISTS blog_posts_fts_au AFTER UPDATE ON blog_posts BEGIN
      INSERT INTO blog_posts_fts(blog_posts_fts, rowid, title, excerpt, content_text) VALUES('delete', old.rowid, old.title, old.excerpt, old.content_text);
      INSERT INTO blog_posts_fts(rowid, title, excerpt, content_text) VALUES (new.rowid, new.title, new.excerpt, new.content_text);
    END;
  `);

  // FTS triggers for youtube_videos
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS youtube_videos_fts_ai AFTER INSERT ON youtube_videos BEGIN
      INSERT INTO youtube_videos_fts(rowid, title, description, transcript_text)
      VALUES (new.rowid, new.title, new.description, new.transcript_text);
    END;
    CREATE TRIGGER IF NOT EXISTS youtube_videos_fts_ad AFTER DELETE ON youtube_videos BEGIN
      INSERT INTO youtube_videos_fts(youtube_videos_fts, rowid, title, description, transcript_text)
      VALUES('delete', old.rowid, old.title, old.description, old.transcript_text);
    END;
    CREATE TRIGGER IF NOT EXISTS youtube_videos_fts_au AFTER UPDATE ON youtube_videos BEGIN
      INSERT INTO youtube_videos_fts(youtube_videos_fts, rowid, title, description, transcript_text)
      VALUES('delete', old.rowid, old.title, old.description, old.transcript_text);
      INSERT INTO youtube_videos_fts(rowid, title, description, transcript_text)
      VALUES (new.rowid, new.title, new.description, new.transcript_text);
    END;
  `);

  // Backfill blog_posts_fts if needed
  try {
    const blogFts = db.prepare("SELECT COUNT(*) as c FROM blog_posts_fts").get() as { c: number };
    const blogCount = db.prepare("SELECT COUNT(*) as c FROM blog_posts").get() as { c: number };
    if (blogCount.c > 0 && blogFts.c === 0) {
      db.prepare("INSERT INTO blog_posts_fts(blog_posts_fts) VALUES('rebuild')").run();
    }
  } catch { /* FTS not ready */ }

  // Backfill youtube_videos_fts if empty. Also covers the post-migration case
  // where we DROPped the legacy 2-column FTS table just above; the next
  // CREATE VIRTUAL TABLE IF NOT EXISTS made a fresh 3-column one with 0 rows.
  try {
    const ytFts = db.prepare("SELECT COUNT(*) as c FROM youtube_videos_fts").get() as { c: number };
    const ytCount = db.prepare("SELECT COUNT(*) as c FROM youtube_videos").get() as { c: number };
    if (ytCount.c > 0 && ytFts.c === 0) {
      db.prepare("INSERT INTO youtube_videos_fts(youtube_videos_fts) VALUES('rebuild')").run();
    }
  } catch { /* FTS not ready */ }

  // github_discussions table
  db.prepare(`CREATE TABLE IF NOT EXISTS github_discussions (
    id TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    db_id INTEGER,
    number INTEGER,
    title TEXT NOT NULL,
    body TEXT,
    category TEXT,
    author TEXT,
    created_at TEXT,
    updated_at TEXT,
    url TEXT NOT NULL UNIQUE,
    upvotes INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    comments_json TEXT,
    answered INTEGER DEFAULT 0,
    synced_at TEXT
  )`).run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_gdisc_repo ON github_discussions(repo, created_at DESC)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_gdisc_created ON github_discussions(created_at DESC)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_gdisc_category ON github_discussions(category, created_at DESC)").run();

  // Migration: add transcript_text + transcript_synced_at to youtube_videos
  const ytCols = db.prepare("PRAGMA table_info(youtube_videos)").all() as Array<{ name: string }>;
  if (ytCols.length > 0 && !ytCols.some(c => c.name === 'transcript_text')) {
    db.prepare("ALTER TABLE youtube_videos ADD COLUMN transcript_text TEXT").run();
    db.prepare("ALTER TABLE youtube_videos ADD COLUMN transcript_synced_at TEXT").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_yt_transcript ON youtube_videos(transcript_synced_at)").run();
  }

  const ytSegmentCols = db.prepare("PRAGMA table_info(youtube_videos)").all() as Array<{ name: string }>;
  if (ytSegmentCols.length > 0 && !ytSegmentCols.some(c => c.name === 'transcript_segments')) {
    db.prepare("ALTER TABLE youtube_videos ADD COLUMN transcript_segments TEXT").run();
  }

  // Performance indexes - composites for hot query patterns identified
  // during the phase-6 audit (Dashboard, RSS feeds).
  //
  // github_items: most reads filter by repo and sort by created_at OR
  // filter by state. Single-column idx_github_items_repo already exists
  // but trailing ORDER BY forces a sort. A composite (repo, created_at)
  // makes the planner use the index for both filter and sort.
  db.prepare("CREATE INDEX IF NOT EXISTS idx_github_items_repo_created ON github_items(repo, created_at DESC)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_github_items_repo_state ON github_items(repo, state)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_github_items_repo_board ON github_items(repo, board_status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_github_items_state ON github_items(state)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_github_items_created ON github_items(created_at DESC)").run();

  // blog_posts: feed + dashboard 'last 7d' queries scan by published_at.
  db.prepare("CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts(published_at DESC)").run();

  // youtube_videos: order by published_at on every detail page + feeds.
  db.prepare("CREATE INDEX IF NOT EXISTS idx_youtube_videos_published ON youtube_videos(published_at DESC)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_youtube_videos_channel ON youtube_videos(channel_name, published_at DESC)").run();

  // sync_log: the freshness readers GROUP by source and take MAX(ran_at).
  db.prepare("CREATE INDEX IF NOT EXISTS idx_sync_log_source_ran ON sync_log(source, ran_at DESC)").run();

  // search_log: every /search render appends one row. Anonymous -
  // no IP, no cookie. Used for popular-query analytics and the
  // 'no-result' frontier (queries that returned 0 results - those
  // become content-gap signals for what to add to the index).
  db.prepare(`CREATE TABLE IF NOT EXISTS search_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    query TEXT NOT NULL,
    result_count INTEGER NOT NULL DEFAULT 0,
    agent_class TEXT
  )`).run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_search_log_ts ON search_log(timestamp DESC)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_search_log_query ON search_log(query, timestamp DESC)").run();

  // csp_violation_log: browser-reported CSP violations. Lets us
  // catch a forgotten third-party CDN before users notice missing
  // functionality, and surfaces XSS attempts that the policy blocked.
  db.prepare(`CREATE TABLE IF NOT EXISTS csp_violation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    document_uri TEXT,
    violated_directive TEXT,
    blocked_uri TEXT,
    source_file TEXT,
    line_number INTEGER
  )`).run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_csp_log_ts ON csp_violation_log(timestamp DESC)").run();

  // Contact form audit log + dedicated rate-limit table.
  // We don't store message bodies long-term - they go straight to the
  // recipient inbox via SMTP. We log {timestamp, ip, status, error}
  // for spam analysis and rate-limit enforcement only.
  db.prepare(`CREATE TABLE IF NOT EXISTS contact_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    ip TEXT,
    email TEXT,
    subject_excerpt TEXT,
    status TEXT NOT NULL,
    error TEXT
  )`).run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_contact_ts ON contact_submissions(timestamp DESC)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_contact_ip_ts ON contact_submissions(ip, timestamp DESC)").run();

  // First-boot ANALYZE: SQLite's query planner needs sqlite_stat1 to
  // pick the new composite indexes over the older single-column ones.
  // After this, scripts/backup-db.sh re-runs ANALYZE nightly.
  try {
    const hasStats = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_stat1' LIMIT 1"
    ).get();
    if (!hasStats) {
      db.exec("ANALYZE");
    }
  } catch { /* sqlite_master quirks - ANALYZE is a noop-safe fallback */ }
}
