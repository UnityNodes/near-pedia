import type React from 'react';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { getDocById, docSourceLabel } from '@/lib/docs';
import { sanitizeDocHtml } from '@/lib/sanitize';
import { CodeCopy } from '@/components/code-copy';
import { TocScrollspy } from '@/components/toc-scrollspy';
import { formatDate } from '@/lib/utils';
import { breadcrumbList, techArticle } from '@/lib/jsonld';
import type { Metadata } from 'next';
import { JsonLd } from '@/components/json-ld';
import { AsideCard, BackLink, KeyValues, MetaLine, ReaderHead, ReaderPage } from '@/components/reader-shell';
import { SITE } from '@/lib/site.config';

export const revalidate = 300;

interface PageProps {
  params: Promise<{ id: string }>;
}


function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');
}

function injectHeadingIds(html: string): string {
  const seen = new Map<string, number>();
  return html.replace(/<h([23])(\s[^>]*)?>([^<]*(?:<(?!\/h[23]>)[^>]*>[^<]*)*)<\/h[23]>/gi, (match, level, attrs = '', inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    if (!text) return match;
    if (/\bid=["'][^"']+["']/.test(attrs)) return match;
    const base = slugify(text) || `heading`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count}`;
    return `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
  });
}

function extractToc(html: string): { id: string; text: string; level: number }[] {
  const toc: { id: string; text: string; level: number }[] = [];
  const regex = /<h([23])[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h[23]>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const level = parseInt(match[1]);
    const id = match[2];
    const text = match[3].replace(/<[^>]+>/g, '').trim();
    if (text) toc.push({ id, text, level });
  }
  return toc;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const doc = getDocById(parseInt(id, 10));
  if (!doc) return {};
  const title = `${doc.title ?? 'Doc'} | ${SITE.name}`;
  const description = doc.excerpt?.slice(0, 160) ?? `Documentation page${doc.source ? ' (' + doc.source + ')' : ''}.`;
  const url = `${SITE.url}/docs/${id}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'article', title, description, url },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function DocPage({ params }: PageProps) {
  const { id } = await params;
  const doc = getDocById(parseInt(id, 10));
  if (!doc) notFound();

  const sourceLabel = docSourceLabel(doc.source, doc.url);
  const htmlWithIds = doc.content_html ? injectHeadingIds(doc.content_html) : null;
  const toc = htmlWithIds ? extractToc(htmlWithIds) : [];

  const schemas = [
    techArticle({
      headline: doc.title ?? 'Documentation Page',
      description: doc.excerpt?.slice(0, 200) ?? `Documentation from ${sourceLabel}.`,
      path: `/docs/${id}`,
      dateModified: doc.last_modified ?? null,
      section: doc.breadcrumb ?? sourceLabel,
      keywords: ['NEAR', sourceLabel, doc.breadcrumb ?? ''].filter(Boolean) as string[],
    }),
    breadcrumbList([
      { name: 'Home', path: '/' },
      { name: 'Documentation', path: '/docs' },
      { name: doc.title ?? 'Doc', path: `/docs/${id}` },
    ]),
  ];

  const aside = (
    <>
      <AsideCard title="Page info">
        <KeyValues
          rows={[
            { k: 'Source', v: sourceLabel },
            doc.breadcrumb ? { k: 'Section', v: doc.breadcrumb } : null,
            doc.last_modified ? { k: 'Updated', v: formatDate(doc.last_modified) } : null,
          ]}
        />
      </AsideCard>
      <AsideCard title="Original">
        <a href={doc.url} target="_blank" rel="noopener noreferrer" className="pg-btn pg-btn--line">
          Original page<ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
        </a>
      </AsideCard>
      {toc.length > 0 && (
        <AsideCard title="Contents">
          <nav className="doc-toc" aria-label="Contents">
            {toc.map((item, i) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="doc-toc-item"
                data-level={item.level}
                data-first={i === 0 ? 'true' : undefined}
              >
                <span className="rd-toc-text">{item.text}</span>
              </a>
            ))}
          </nav>
        </AsideCard>
      )}
    </>
  );

  return (
    <>
      <JsonLd payload={schemas} />
      <ReaderPage
        crumbs={[{ label: 'Documentation', href: '/docs' }, { label: doc.title ?? 'Documentation Page' }]}
        aside={aside}
      >
        <ReaderHead
          tags={
            <>
              <span className="pg-tag" data-tone="lime">{sourceLabel}</span>
              {doc.breadcrumb && <span className="pg-tag">{doc.breadcrumb}</span>}
            </>
          }
          title={doc.title ?? 'Documentation Page'}
          meta={doc.last_modified ? <MetaLine items={[<span key="u">Updated {formatDate(doc.last_modified)}</span>]} /> : undefined}
          actions={
            <a href={doc.url} target="_blank" rel="noopener noreferrer" className="pg-btn pg-btn--line">
              View on {sourceLabel}<ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
            </a>
          }
        />
        {htmlWithIds ? (
          <div
            className="rd-prose rd-body"
            dangerouslySetInnerHTML={{ __html: sanitizeDocHtml(htmlWithIds) }}
          />
        ) : (
          <>
            {doc.excerpt && <p className="rd-lede">{doc.excerpt}</p>}
            <div className="rd-actions rd-actions--after">
              <a href={doc.url} target="_blank" rel="noopener noreferrer" className="pg-btn">
                Read on {sourceLabel}<ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
              </a>
            </div>
          </>
        )}
        <CodeCopy selector=".rd-body" />
        <TocScrollspy contentSelector=".rd-body" />
        <BackLink href="/docs"><ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />Back to Documentation</BackLink>
      </ReaderPage>
    </>
  );
}
