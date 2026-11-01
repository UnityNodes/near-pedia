import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { getTopicWithPosts } from '@/lib/forum';
import { sanitizeDiscourseHtml } from '@/lib/sanitize';
import { formatRelativeTime } from '@/lib/utils';
import { CodeCopy } from '@/components/code-copy';
import { HeartIcon } from '@/components/topic-row';
import { extractCipReferences } from '@/lib/cip-autolink';
import type { Metadata } from 'next';
import { JsonLd } from '@/components/json-ld';
import { AsideCard, BackLink, KeyValues, MetaLine, ReaderHead, ReaderPage } from '@/components/reader-shell';
import { SITE } from '@/lib/site.config';

export const revalidate = 300;

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const topic = await getTopicWithPosts(parseInt(id, 10));
  if (!topic) return {};
  const title = `${topic.title} | ${SITE.name} Discussions`;
  const description = `Forum discussion: ${topic.title}`;
  const url = `${SITE.url}/discussions/${id}`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { type: 'article', title, description, url },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function TopicPage({ params }: PageProps) {
  const { id } = await params;
  const topic = await getTopicWithPosts(parseInt(id, 10));

  if (!topic) notFound();

  // Collect every CIP-N referenced in the topic title or any post body.
  // Strip HTML tags before extracting so 'href="/cips/0042"' inside an
  // anchor doesn't double-count.
  const cipChips: string[] = (() => {
    const collected = new Set<string>();
    const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ');
    for (const ref of extractCipReferences(topic.title)) collected.add(ref);
    for (const p of topic.posts) {
      const text = stripHtml(p.cooked ?? '');
      for (const ref of extractCipReferences(text)) collected.add(ref);
    }
    return Array.from(collected).sort();
  })();

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'DiscussionForumPosting',
    headline: topic.title,
    url: `${SITE.url}/discussions/${id}`,
    datePublished: topic.created_at,
    dateModified: topic.last_post_at ?? topic.created_at,
    author: topic.last_poster_username ? { '@type': 'Person', name: topic.last_poster_username } : undefined,
    isPartOf: { '@type': 'WebSite', name: SITE.name, url: SITE.url },
    interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/ReplyAction', userInteractionCount: topic.posts_count ?? 0 },
  };

  const posts = topic.posts.filter(post => post.cooked?.replace(/<[^>]+>/g, '').trim());

  const aside = (
    <AsideCard title="Topic info">
      <KeyValues
        rows={[
          { k: 'Posts', v: topic.posts_count },
          { k: 'Views', v: topic.views.toLocaleString() },
          topic.like_count > 0 ? { k: 'Likes', v: topic.like_count } : null,
          topic.category_name ? { k: 'Category', v: topic.category_name } : null,
          { k: 'Activity', v: formatRelativeTime(topic.last_post_at) },
        ]}
      />
    </AsideCard>
  );

  return (
    <>
      <JsonLd payload={schema} />
      <ReaderPage crumbs={[{ label: 'Discussions', href: '/discussions' }, { label: topic.title }]} aside={aside}>
        <ReaderHead
          tags={topic.category_name ? <span className="pg-tag" data-tone="info">{topic.category_name}</span> : undefined}
          title={topic.title}
          meta={
            <MetaLine
              items={[
                <span key="p">{topic.posts_count} posts</span>,
                <span key="v">{topic.views.toLocaleString()} views</span>,
                topic.like_count > 0 ? <span key="l">{topic.like_count} likes</span> : null,
                <span key="a">Last activity {formatRelativeTime(topic.last_post_at)}</span>,
              ]}
            />
          }
          actions={
            <a href={topic.url} target="_blank" rel="noopener noreferrer" className="pg-btn pg-btn--line">
              Open on Forum<ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
            </a>
          }
        />

        {cipChips.length > 0 && (
          <div className="rd-chips">
            <span className="rd-chips-label">CIPs mentioned</span>
            {cipChips.map(num => <Link key={num} href={`/cips/${num}`} className="rd-chip">CIP-{num}</Link>)}
          </div>
        )}

        {topic.posts.length === 0 ? (
          <div className="rd-empty">
            <p>Could not load posts.{' '}
              <a href={topic.url} target="_blank" rel="noopener noreferrer">Open on Forum ↗</a>
            </p>
          </div>
        ) : (
          <ol className="rd-posts">
            {posts.map((post, i) => (
              <li key={post.id} className="rd-post">
                <div className="rd-post-head">
                  <span className="rd-avatar" aria-hidden="true">{(post.username ?? 'A').slice(0, 2)}</span>
                  <span className="rd-post-who">
                    {post.username ?? 'Anonymous'}
                    {i === 0 && <span className="pg-tag" data-tone="lime">OP</span>}
                  </span>
                  <time className="rd-post-time" dateTime={post.created_at}>{formatRelativeTime(post.created_at)}</time>
                  {post.like_count > 0 && (
                    <span className="rd-post-likes"><HeartIcon /> {post.like_count}</span>
                  )}
                </div>
                <div
                  className="discourse-post rd-prose"
                  dangerouslySetInnerHTML={{ __html: sanitizeDiscourseHtml(post.cooked) }}
                />
              </li>
            ))}
          </ol>
        )}

        <CodeCopy selector=".rd-main" />
        <BackLink href="/discussions"><ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />Back to Discussions</BackLink>
      </ReaderPage>
    </>
  );
}
