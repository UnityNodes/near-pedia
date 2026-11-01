import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { getRelatedVideos, getVideo, transcriptOf } from '@/lib/videos';
import { formatDateLong } from '@/lib/utils';
import { descriptionParagraphs, descriptionParts } from '@/lib/video-description';
import { formatClock, plainParagraphs } from '@/lib/video-transcript';
import { TRUNCATION_MARKER } from '@/lib/cap-text';
import { JsonLd } from '@/components/json-ld';
import { AsideCard, BackLink, KeyValues, LinkCards, MetaLine, ReaderHead, ReaderPage, RelCard } from '@/components/reader-shell';
import { VideoWatch } from '@/components/video-watch';
import { SITE } from '@/lib/site.config';

export const revalidate = 300;

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const video = getVideo(id);
  if (!video) return { title: 'Not Found' };
  const title = `${video.title}`;
  const brandedTitle = `${title} | ${SITE.name}`;
  const description = video.description?.slice(0, 160) ?? `Video by ${video.channel_name ?? 'NEAR'}`;
  const thumbnail = video.thumbnail_url ?? `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE.url}/videos/${id}` },
    openGraph: {
      type: 'video.other',
      title: brandedTitle,
      description,
      url: `${SITE.url}/videos/${id}`,
      images: [{ url: thumbnail, width: 480, height: 360 }],
      videos: [{ url: `https://www.youtube.com/embed/${id}`, type: 'text/html', width: 1280, height: 720 }],
    },
    twitter: { card: 'player', title: brandedTitle, description, images: [thumbnail], players: [{ playerUrl: `https://www.youtube.com/embed/${id}`, streamUrl: `https://www.youtube.com/embed/${id}`, width: 1280, height: 720 }] },
  };
}

export default async function VideoPage({ params }: PageProps) {
  const { id } = await params;
  const video = getVideo(id);
  if (!video) notFound();

  const paragraphs = descriptionParagraphs(video.description);
  const transcript = transcriptOf(video);
  const hasTranscript = transcript.blocks.length > 0 || Boolean(transcript.plain);
  const words = transcript.plain ? transcript.plain.split(/\s+/).filter(Boolean).length : 0;
  const lastStart = transcript.blocks.length > 0 ? transcript.blocks[transcript.blocks.length - 1].start : null;
  const related = getRelatedVideos(id, video.channel_name, 3);

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: video.description?.slice(0, 200) ?? undefined,
    url: `${SITE.url}/videos/${id}`,
    embedUrl: `https://www.youtube.com/embed/${id}`,
    contentUrl: video.url,
    thumbnailUrl: video.thumbnail_url ?? `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    uploadDate: video.published_at ?? undefined,
    publisher: { '@type': 'Organization', name: video.channel_name ?? 'NEAR', url: 'https://near.org' },
    isPartOf: { '@type': 'WebSite', name: SITE.name, url: SITE.url },
  };

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE.url },
      { '@type': 'ListItem', position: 2, name: 'Videos', item: `${SITE.url}/videos` },
      { '@type': 'ListItem', position: 3, name: video.title, item: `${SITE.url}/videos/${id}` },
    ],
  };

  const aside = (
    <>
      <AsideCard title="About this video">
        <KeyValues
          rows={[
            video.channel_name ? { k: 'Channel', v: video.channel_name } : null,
            video.published_at ? { k: 'Date', v: formatDateLong(video.published_at) } : null,
            { k: 'Text', v: hasTranscript ? (transcript.timed ? 'Transcript with times' : 'Transcript') : 'No transcript' },
          ]}
        />
      </AsideCard>
      <AsideCard title="Read it from an agent">
        <p className="rd-card-text">
          {hasTranscript
            ? 'Ask for the whole transcript, or for the passages that mention a word, each with its time.'
            : 'No transcript is held for this video, but the title, date and description are available.'}
        </p>
        <pre className="rd-card-code"><code>{hasTranscript ? `get_video\n  id: ${id}\n  query: "your term"` : `get_video\n  id: ${id}`}</code></pre>
        <div className="rd-card-links">
          <a href={`/api/v1/videos/${id}`} className="rd-card-link">JSON for this video<ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" /></a>
          <Link href="/for-ai" className="rd-card-link">Connect MCP</Link>
        </div>
      </AsideCard>
      {related.length > 0 ? (
        <LinkCards title={`More from ${video.channel_name}`}>
          {related.map(r => (
            <RelCard
              key={r.id}
              href={`/videos/${r.id}`}
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
      <ReaderPage crumbs={[{ label: 'Videos', href: '/videos' }, { label: video.title }]} aside={aside}>
        <ReaderHead
          tags={video.channel_name ? <span className="pg-tag" data-tone="info">{video.channel_name}</span> : undefined}
          title={video.title}
          meta={
            <MetaLine
              items={[
                video.published_at ? <time key="d" dateTime={video.published_at}>{formatDateLong(video.published_at)}</time> : null,
                lastStart !== null ? <span key="l">about {formatClock(lastStart)} long</span> : null,
              ]}
            />
          }
          actions={
            <a href={video.url} target="_blank" rel="noopener noreferrer" className="pg-btn pg-btn--line">
              Watch on YouTube<ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
              <span className="pg-sr"> (opens in a new tab)</span>
            </a>
          }
        />

        <VideoWatch
          id={id}
          title={video.title}
          thumbnail={video.thumbnail_url}
          blocks={transcript.blocks}
          paragraphs={transcript.timed || !transcript.plain ? [] : plainParagraphs(transcript.plain)}
          words={words}
        >
          {paragraphs.length > 0 ? (
            <section className="rd-desc" aria-labelledby="rd-desc-title">
              <h2 id="rd-desc-title" className="rd-h2">About this video</h2>
              {paragraphs.map((p, i) => (
                <p key={i}>
                  {descriptionParts(p).map((part, j) => part.kind === 'link'
                    ? <a key={j} href={part.href} target="_blank" rel="noopener noreferrer nofollow ugc">{part.label}</a>
                    : <span key={j}>{part.text}</span>
                  )}
                </p>
              ))}
            </section>
          ) : null}
          {transcript.plain?.endsWith(TRUNCATION_MARKER) ? (
            <p className="rd-tx-empty">This transcript is cut at our storage limit. Watch the video for the rest.</p>
          ) : null}
          {!hasTranscript ? (
            <section className="rd-tx" aria-labelledby="rd-tx-title">
              <h2 id="rd-tx-title" className="rd-h2">Transcript</h2>
              <p className="rd-tx-empty">YouTube has no captions for this video, so there is no text to read. We look again once a day.</p>
            </section>
          ) : null}
        </VideoWatch>

        <BackLink href="/videos"><ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />All videos</BackLink>
      </ReaderPage>
    </>
  );
}
