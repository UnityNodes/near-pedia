import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { resetDb, getDb } from '@/lib/db';
import { DocsLanding, cardHref } from '@/components/docs-landing';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

function seed(id: number, url: string) {
  getDb().prepare(
    'INSERT INTO doc_pages (id, url, title, breadcrumb, excerpt, content_text, source, last_modified, synced_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(id, url, 'T', 'B', 'E', 'C', 'docs', '2026-01-01', '2026-01-01T00:00:00Z');
}

describe('docs landing cards', () => {
  beforeEach(() => { resetDb(); });

  it('links each guide by its address, so a renumbered table does not break the card', () => {
    seed(7001, 'https://docs.near.org/getting-started/what-is-near');
    seed(7002, 'https://docs.near.org/smart-contracts/quickstart');
    seed(7003, 'https://docs.near.org/protocol/network/validators');
    const html = renderToStaticMarkup(<DocsLanding />);
    expect(html).toContain('href="/docs/7001"');
    expect(html).toContain('href="/docs/7002"');
    expect(html).toContain('href="/docs/7003"');
  });

  it('falls back to the docs index rather than a dead id when the page is not held', () => {
    const html = renderToStaticMarkup(<DocsLanding />);
    expect(html).not.toMatch(/href="\/docs\/\d+"/);
    expect(html).toContain('href="/docs"');
  });

  it('keeps a fixed link as it is', () => {
    expect(cardHref({ href: '/ask' }, () => 1)).toBe('/ask');
    expect(cardHref({ doc: 'https://x' }, () => 12)).toBe('/docs/12');
    expect(cardHref({ doc: 'https://x' }, () => null)).toBe('/docs');
  });
});
