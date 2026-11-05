import { notFound, permanentRedirect } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { authorLabel, getBlogPost, getBlogPosts, isBlogSource, kindLabel, servesFullText, shortLine, sourceHost } from '@/lib/blog';
import type { BlogKind, BlogPost } from '@/lib/blog';
import { withHeadingIds } from '@/lib/blog-html';
import { formatDateLong } from '@/lib/utils';
import { sanitizeDocHtml } from '@/lib/sanitize';
import { JsonLd } from '@/components/json-ld';
import { AsideCard, BackLink, KeyValues, LinkCards, MetaLine, ReaderHead, ReaderPage, RelCard } from '@/components/reader-shell';
import { TocScrollspy } from '@/components/toc-scrollspy';
import { SITE } from '@/lib/site.config';

const EXCERPT_CHARS = 700;
const MIN_HEADINGS_FOR_CONTENTS = 3;

interface Publisher {
  name: string;
  url: string;
}

function publisherOf(kind: BlogKind, host: string | null): Publisher {
  if (kind === 'partner-news' || kind === 'third-party') return { name: host ?? 'Third party', url: host ? `https://${host}` : SITE.url };
  return { name: SITE.publisher.name, url: SITE.publisher.url };
}

function paragraphsOf(text: string | null): string[] {
  return (text ?? '').split(/\n\n+/).map(p => p.trim()).filter(Boolean);
}

function postId(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export function BlogPostPageContent({ id: raw }: { id: string }) {
  const id = postId(raw);
  const post = id ? getBlogPost(id) : null;
  if (!post) notFound();
  if (post.kind === 'release') permanentRedirect(`/releases/${id}`);

  const fullText = servesFullText(post.kind);
  const host = sourceHost(post.url);
  const author = authorLabel(post.author);
  const publisher = publisherOf(post.kind, host);
  const label = kindLabel(post.kind);
  const backHref = isBlogSource(post.kind) ? `/blog?source=${post.kind}` : '/blog';

  const rawHtml = post.content_html && post.content_html.length > 100 ? post.content_html : null;
  const body = fullText && rawHtml ? withHeadingIds(sanitizeDocHtml(rawHtml)) : null;
  const headings = body?.headings.filter(h => h.level === 2 || h.level === 3) ?? [];
  const showContents = headings.filter(h => h.level === 2).length >= MIN_HEADINGS_FOR_CONTENTS;
  const paragraphs = fullText && !body ? paragraphsOf(post.content_text) : [];
  const excerpt = fullText ? '' : shortLine(post.excerpt, post.content_text, EXCERPT_CHARS);

  const related = isBlogSource(post.kind)
    ? getBlogPosts({ source: post.kind, perPage: 4 }).posts.filter(p => p.id !== post.id).slice(0, 3)
    : [];

  const pageUrl = `${SITE.url}/blog/${id}`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt?.slice(0, 200) ?? undefined,
    url: fullText ? pageUrl : post.url,
    datePublished: post.published_at ?? undefined,
    dateModified: post.synced_at,
    author: author ? { '@type': 'Person', name: author } : undefined,
    publisher: { '@type': 'Organization', name: publisher.name, url: publisher.url },
    isPartOf: { '@type': 'WebSite', name: SITE.name, url: SITE.url },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE.url },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE.url}/blog` },
      { '@type': 'ListItem', position: 3, name: post.title, item: pageUrl },
    ],
  };

  const contents = showContents ? (
    <nav aria-label="Contents" className="doc-toc">
      {headings.map((h, i) => (
        <a key={h.id} href={`#${h.id}`} className="doc-toc-item" data-level={h.level} data-first={i === 0 ? 'true' : undefined}>
          <span className="rd-toc-text">{h.text}</span>
        </a>
      ))}
    </nav>
  ) : null;

  const aside = (
    <>
      <AsideCard title="About this post">
        <KeyValues
          rows={[
            { k: 'Kind', v: label },
            { k: 'Publisher', v: publisher.name },
            author ? { k: 'Author', v: author } : null,
            post.published_at ? { k: 'Date', v: formatDateLong(post.published_at) } : null,
          ]}
        />
      </AsideCard>
      {contents ? (
        <AsideCard title="On this page" className="rd-toc-aside">
          {contents}
        </AsideCard>
      ) : null}
      {related.length > 0 ? (
        <LinkCards title={`More in ${label}`}>
          {related.map(r => (
            <RelCard
              key={r.id}
              href={`/blog/${r.id}`}
              title={r.title}
              date={r.published_at ? formatDateLong(r.published_at) : undefined}
            />
          ))}
        </LinkCards>
      ) : null}
    </>
  );

  return (
    <>
      <JsonLd payload={schema} />
      <JsonLd payload={breadcrumb} />
      <ReaderPage crumbs={[{ label: 'Blog', href: '/blog' }, { label: post.title }]} aside={aside}>
        <ReaderHead
          tags={<span className="pg-tag" data-tone="lime">{label}</span>}
          title={post.title}
          meta={
            <MetaLine
              items={[
                author ? <span key="a">{author}</span> : null,
                post.published_at ? <time key="d" dateTime={post.published_at}>{formatDateLong(post.published_at)}</time> : null,
                host ? <span key="h">{host}</span> : null,
              ]}
            />
          }
          actions={
            <a href={post.url} target="_blank" rel="noopener noreferrer" className="pg-btn pg-btn--line">
              {fullText ? `Open on ${host ?? 'the source'}` : 'Read the original'}<ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
              <span className="pg-sr"> (opens in a new tab)</span>
            </a>
          }
        />

        {!fullText ? (
          <section className="rd-excerpt" aria-label="Excerpt">
            <p>{excerpt}</p>
            <p className="rd-excerpt-note">
              This is {post.kind === 'partner-news' ? 'a press release published by a partner' : 'a reprint'} on {host ?? 'another site'}.{' '}
              {SITE.name} shows the opening and links to the original, which is where it belongs.
            </p>
          </section>
        ) : null}

        {contents ? (
          <details className="rd-toc-mobile">
            <summary>Contents<span className="rd-toc-count">{headings.filter(h => h.level === 2).length} sections</span></summary>
            {contents}
          </details>
        ) : null}

        {body ? (
          <div className="rd-prose rd-body" dangerouslySetInnerHTML={{ __html: body.html }} />
        ) : paragraphs.length > 0 ? (
          <div className="rd-prose rd-body">
            {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
          </div>
        ) : fullText ? (
          <div className="rd-empty">
            <p>We hold no text for this post. The original is linked above.</p>
          </div>
        ) : null}
        {showContents ? <TocScrollspy contentSelector=".rd-body" /> : null}

        <BackLink href={backHref}><ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />{label}</BackLink>
      </ReaderPage>
    </>
  );
}

export function getBlogPostMetadata(raw: string) {
  const id = postId(raw);
  const post: BlogPost | null = id ? getBlogPost(id) : null;
  if (!post || post.kind === 'release') return { title: 'Not Found' };
  const fullText = servesFullText(post.kind);
  const brandedTitle = `${post.title} | ${SITE.name}`;
  const description = shortLine(post.excerpt, post.content_text, 200) || `${kindLabel(post.kind)}: ${post.title}.`;
  const canonical = fullText ? `${SITE.url}/blog/${id}` : post.url;
  return {
    title: post.title,
    description,
    alternates: { canonical },
    openGraph: { type: 'article' as const, title: brandedTitle, description },
    twitter: { card: 'summary_large_image' as const, title: brandedTitle, description },
  };
}
