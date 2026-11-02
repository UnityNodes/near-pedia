import { getDb } from './db';

export interface SiteStats {
  topics: number;
  posts: number;
  docs: number;
}

export interface AiUsageStats {
  embeddingChunks: number;
  embeddedSources: number;
}

export interface NetworkSnapshot {
  id: number;
  snapshot_at: string;
  forum_topics: number;
  forum_posts: number;
  github_items_open: number;
  github_items_closed: number;
  docs: number;
  videos: number;
  blog_posts: number;
  radar_critical: number;
  radar_important: number;
}

export function getLatestNetworkSnapshot(): NetworkSnapshot | null {
  const db = getDb();
  try {
    return (db.prepare('SELECT * FROM network_stats ORDER BY snapshot_at DESC LIMIT 1').get() as NetworkSnapshot | undefined) ?? null;
  } catch {
    return null;
  }
}

export function getNetworkStatsHistory(limit = 90): NetworkSnapshot[] {
  const db = getDb();
  try {
    // Newest N, then flipped back to chronological order for plotting. A plain
    // `ASC LIMIT ?` takes the OLDEST N instead: the charts silently dropped the
    // most recent snapshot, and once the table outgrew the limit they would
    // have frozen on ancient history while looking perfectly healthy.
    return db.prepare(`
      SELECT * FROM (
        SELECT * FROM network_stats ORDER BY snapshot_at DESC LIMIT ?
      ) ORDER BY snapshot_at ASC
    `).all(limit) as NetworkSnapshot[];
  } catch {
    return [];
  }
}

export function getSiteStats(): SiteStats {
  const db = getDb();
  const topics = (db.prepare('SELECT COUNT(*) as c FROM forum_topics').get() as { c: number }).c;
  const posts = (db.prepare('SELECT COUNT(*) as c FROM forum_posts').get() as { c: number }).c;
  const docs = (db.prepare('SELECT COUNT(*) as c FROM doc_pages').get() as { c: number }).c;
  return { topics, posts, docs };
}

export function getAiUsageStats(): AiUsageStats {
  const db = getDb();
  const result: AiUsageStats = {
    embeddingChunks: 0,
    embeddedSources: 0,
  };

  try {
    result.embeddingChunks = (db.prepare(
      'SELECT COUNT(*) as c FROM embedding_chunks'
    ).get() as { c: number }).c;
    result.embeddedSources = (db.prepare(
      'SELECT COUNT(DISTINCT source_type) as c FROM embedding_chunks'
    ).get() as { c: number }).c;
  } catch {}

  return result;
}
