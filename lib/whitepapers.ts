import { getDb } from './db';

export interface Whitepaper {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  tag: string | null;
  pdf_url: string;
  content_text: string | null;
  pages: number | null;
  synced_at: string | null;
}

export function getAllWhitepapers(): Whitepaper[] {
  return getDb().prepare(
    'SELECT * FROM whitepapers ORDER BY id'
  ).all() as Whitepaper[];
}

export function getWhitepaperBySlug(slug: string): Whitepaper | null {
  return (getDb().prepare('SELECT * FROM whitepapers WHERE slug = ?').get(slug) as Whitepaper | undefined) ?? null;
}
