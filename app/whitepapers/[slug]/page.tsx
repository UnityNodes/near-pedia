import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { getWhitepaperBySlug, getAllWhitepapers } from '@/lib/whitepapers';
import type { Metadata } from 'next';
import { JsonLd } from '@/components/json-ld';
import { AsideCard, BackLink, KeyValues, MetaLine, ReaderHead, ReaderPage } from '@/components/reader-shell';
import { TocScrollspy } from '@/components/toc-scrollspy';
import { SITE } from '@/lib/site.config';
import { contentsOf, readerText } from '@/lib/whitepaper-text';
import type { ContentsItem } from '@/lib/whitepaper-text';
import { paperFacts } from '@/lib/whitepaper-meta';

export const revalidate = 300;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllWhitepapers().map(wp => ({ slug: wp.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const wp = getWhitepaperBySlug(slug);
  if (!wp) return {};
  const title = `${wp.title}`;
  const brandedTitle = `${title} | ${SITE.name}`;
  const description = paperFacts(wp).description ?? `YourChain whitepaper: ${wp.title}.`;
  const url = `${SITE.url}/whitepapers/${slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title: brandedTitle,
      description,
      url,
      // images auto-merged from app/whitepapers/[slug]/opengraph-image.tsx
    },
    twitter: { card: 'summary_large_image', title: brandedTitle, description },
  };
}

function ContentsList({ items }: { items: ContentsItem[] }) {
  return (
    <nav aria-label="Contents" className="doc-toc">
      {items.map((item, i) => (
        <a key={item.id} href={`#${item.id}`} className="doc-toc-item" data-level={item.level} data-first={i === 0 ? 'true' : undefined}>
          <span className="rd-toc-text">{item.text}</span>
        </a>
      ))}
    </nav>
  );
}

export default async function WhitepaperPage({ params }: PageProps) {
  const { slug } = await params;
  const wp = getWhitepaperBySlug(slug);

  if (!wp) notFound();

  const facts = paperFacts(wp);
  const { blocks } = readerText(wp.content_text);
  const contents = contentsOf(blocks, wp.title);
  const pages = facts.isPdf && wp.pages ? wp.pages : null;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Report',
    headline: wp.title,
    description: facts.description ?? undefined,
    url: `${SITE.url}/whitepapers/${slug}`,
    datePublished: facts.date ?? undefined,
    publisher: { '@type': 'Organization', name: facts.publisher },
    author: facts.author ? { '@type': facts.author.organization ? 'Organization' : 'Person', name: facts.author.name, jobTitle: facts.author.role } : undefined,
    sameAs: wp.pdf_url,
    isPartOf: { '@type': 'WebSite', name: SITE.name, url: SITE.url },
  };

  const aside = (
    <>
      <AsideCard title="About this paper">
        <KeyValues
          rows={[
            { k: 'Publisher', v: facts.publisher },
            facts.authorLabel ? { k: 'Author', v: facts.authorLabel } : null,
            facts.dateLabel ? { k: 'Date', v: facts.dateLabel } : null,
            pages ? { k: 'Pages', v: pages } : null,
            facts.sourceHost ? { k: 'Source', v: <span className="rd-kv-mono">{facts.sourceHost}</span> } : null,
          ]}
        />
        {facts.dateNote ? <p className="rd-card-note">Date: {facts.dateNote}.</p> : null}
      </AsideCard>
      {contents.length > 0 ? (
        <AsideCard title="Contents" className="rd-toc-aside">
          <ContentsList items={contents} />
        </AsideCard>
      ) : null}
    </>
  );

  return (
    <>
      <JsonLd payload={schema} />
      <ReaderPage crumbs={[{ label: 'Whitepapers', href: '/whitepapers' }, { label: wp.title }]} aside={aside}>
        <ReaderHead
          tags={<span className="pg-tag" data-tone="lime">{facts.publisher}</span>}
          title={wp.title}
          meta={
            <MetaLine
              items={[
                facts.authorLabel ? <span key="a">{facts.authorLabel}</span> : null,
                facts.dateLabel ? <time key="d" dateTime={facts.date ?? undefined}>{facts.dateLabel}</time> : null,
                pages ? <span key="p">{pages} pages</span> : null,
              ]}
            />
          }
          lede={facts.description || undefined}
          actions={
            <>
              <a href={wp.pdf_url} target="_blank" rel="noopener noreferrer" className="pg-btn pg-btn--line">
                {facts.sourceAction}<ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
                <span className="pg-sr"> (opens in a new tab)</span>
              </a>
              {facts.sourceHost ? <span className="rd-host">{facts.sourceHost}</span> : null}
            </>
          }
        />

        {contents.length > 0 ? (
          <details className="rd-toc-mobile">
            <summary>Contents<span className="rd-toc-count">{contents.length} {contents.length === 1 ? 'section' : 'sections'}</span></summary>
            <ContentsList items={contents} />
          </details>
        ) : null}

        {blocks.length > 0 ? (
          <div className="rd-prose rd-body">
            {blocks.map((b, i) => {
              if (b.kind === 'page') return <div key={`page-${b.n}`} id={`p-${b.n}`} className="wp-page">p. {b.n}</div>;
              if (b.kind === 'heading') return b.level === 3 ? <h3 key={b.id} id={b.id}>{b.text}</h3> : <h2 key={b.id} id={b.id}>{b.text}</h2>;
              return <p key={i} className={b.keepLines ? 'wpx-lines' : undefined}>{b.text}</p>;
            })}
          </div>
        ) : (
          <div className="rd-empty">
            <p>We hold no text for this paper yet. The original is linked above.</p>
          </div>
        )}
        <TocScrollspy contentSelector=".rd-body" />

        <BackLink href="/whitepapers"><ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />All whitepapers</BackLink>
      </ReaderPage>
    </>
  );
}
