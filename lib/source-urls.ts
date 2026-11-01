import { getDb } from './db';

export interface SourceLink {
  url: string;
  label: string;
  sourceType: string;
  snippet?: string;
  /** 1-based citation number as it appears in the answer text (e.g. [4]).
   *  Preserved across filtering so the UI can label the card with the same number the LLM used. */
  displayIndex?: number;
}

export function buildSourceLink(sourceType: string, sourceId: string): SourceLink | null {
  try {
    return buildSourceLinkUnsafe(sourceType, sourceId);
  } catch (err) {
    console.error(`[buildSourceLink] failed for ${sourceType}/${sourceId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

function buildSourceLinkUnsafe(sourceType: string, sourceId: string): SourceLink | null {
  switch (sourceType) {
    case 'cip': {
      // sourceId can be number like "0042" or "PR-204"
      if (sourceId.startsWith('PR-')) {
        const num = sourceId.slice(3);
        return { url: `https://github.com/your-org/CIPs/pull/${num}`, label: `CIP draft PR #${num}`, sourceType };
      }
      return { url: `https://yourpedia.example/cips/${sourceId}`, label: `CIP-${sourceId}`, sourceType };
    }
    case 'github_item': {
      // sourceId like "your-org/yourchain-node#5071"; app/proposals/[...slug]
      // reconstructs this same id from the org/repo/number it parses back out
      // of the slug, so the replace below must keep producing exactly 3
      // '/'-separated segments.
      const row = getDb().prepare('SELECT url, title, number FROM github_items WHERE id = ?').get(sourceId) as { url: string; title: string; number: number } | undefined;
      if (row) return { url: `https://yourpedia.example/proposals/${sourceId.replace('#', '/')}`, label: `Proposal #${row.number}: ${row.title}`, sourceType };
      return null;
    }
    case 'forum_topic': {
      const row = getDb().prepare('SELECT url, title FROM forum_topics WHERE id = ?').get(sourceId) as { url: string; title: string } | undefined;
      if (row) return { url: row.url, label: row.title || `Forum topic ${sourceId}`, sourceType };
      return null;
    }
    case 'blog_post': {
      const row = getDb().prepare('SELECT url, title FROM blog_posts WHERE id = ?').get(sourceId) as { url: string; title: string } | undefined;
      if (row) return { url: row.url, label: row.title || 'Blog post', sourceType };
      return null;
    }
    case 'doc_page': {
      const row = getDb().prepare('SELECT url, title FROM doc_pages WHERE id = ?').get(sourceId) as { url: string; title: string } | undefined;
      if (row) return { url: row.url, label: row.title || 'Documentation', sourceType };
      return null;
    }
    case 'whitepaper': {
      const row = getDb().prepare('SELECT slug, title, pdf_url FROM whitepapers WHERE id = ?').get(sourceId) as { slug: string; title: string; pdf_url: string } | undefined;
      if (row) return { url: `https://yourpedia.example/whitepapers/${row.slug}`, label: row.title || 'Whitepaper', sourceType };
      return null;
    }
    case 'youtube_video': {
      const row = getDb().prepare(
        'SELECT title, channel_name FROM youtube_videos WHERE id = ?'
      ).get(sourceId) as { title: string | null; channel_name: string | null } | undefined;
      const label = row?.title
        ? `${row.title}${row.channel_name ? ` - ${row.channel_name}` : ''}`
        : `YouTube video ${sourceId}`;
      return { url: `https://www.youtube.com/watch?v=${sourceId}`, label, sourceType };
    }
    case 'github_release': {
      const row = getDb().prepare(
        'SELECT repo, name, tag, url FROM github_releases WHERE id = ?'
      ).get(sourceId) as { repo: string; name: string | null; tag: string; url: string } | undefined;
      if (!row) return null;
      const label = `${row.repo} ${row.name ?? row.tag}`;
      return { url: row.url, label, sourceType };
    }
    case 'ecosystem_project': {
      const row = getDb().prepare(
        'SELECT title, url, category FROM ecosystem_projects WHERE slug = ?'
      ).get(sourceId) as { title: string; url: string; category: string | null } | undefined;
      if (!row) return null;
      const label = row.category ? `${row.title} (${row.category})` : row.title;
      return { url: row.url, label, sourceType };
    }
    case 'github_discussion': {
      try {
        const row = getDb().prepare(
          'SELECT repo, title, url, category FROM github_discussions WHERE id = ?'
        ).get(sourceId) as { repo: string; title: string; url: string; category: string | null } | undefined;
        if (!row) return null;
        const label = `${row.repo} · ${row.category ?? 'discussion'}: ${row.title}`;
        return { url: row.url, label, sourceType };
      } catch {
        return null;
      }
    }
    case 'foundation_kb': {
      const row = getDb().prepare(
        'SELECT title, url, category FROM foundation_kb WHERE id = ?'
      ).get(sourceId) as { title: string; url: string | null; category: string | null } | undefined;
      if (!row) return null;
      const label = row.category ? `${row.title} (${row.category})` : (row.title || 'Foundation KB');
      return { url: row.url || 'https://yourpedia.example/docs', label, sourceType };
    }
    case 'radar_item': {
      const row = getDb().prepare(
        'SELECT title, source_url, level FROM radar_items WHERE id = ?'
      ).get(sourceId) as { title: string; source_url: string | null; level: string } | undefined;
      if (!row) return null;
      return { url: row.source_url || 'https://yourpedia.example/radar', label: `[${row.level}] ${row.title}`, sourceType };
    }
    default:
      return null;
  }
}
