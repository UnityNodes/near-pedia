import Link from 'next/link';
import Image from 'next/image';
import { FileText } from 'lucide-react';
import type { VideoListItem } from '@/lib/videos';
import { formatDateLong } from '@/lib/utils';
import { formatClock } from '@/lib/video-transcript';
import { markWords } from '@/components/doc-card';

export function VideoCard({ video, query }: { video: VideoListItem; query?: string }) {
  const href = `/videos/${video.id}`;
  return (
    <li className="vidx-card">
      <Link href={href} className="vidx-thumb" tabIndex={-1} aria-hidden="true">
        {video.thumbnail_url
          ? <Image src={video.thumbnail_url} alt="" fill sizes="(max-width: 640px) 100vw, 320px" style={{ objectFit: 'cover' }} />
          : null}
        {video.has_transcript ? (
          <span className="vidx-badge"><FileText size={12} strokeWidth={1.75} aria-hidden="true" />Transcript</span>
        ) : null}
      </Link>
      <div className="vidx-body">
        <Link href={href} className="vidx-title">{markWords(video.title, query)}</Link>
        <span className="vidx-meta">
          {video.channel_name ? <span className="vidx-channel">{video.channel_name}</span> : null}
          {video.published_at ? <time dateTime={video.published_at}>{formatDateLong(video.published_at)}</time> : <span>Undated</span>}
        </span>
        {video.passage ? (
          <Link href={`${href}?t=${Math.floor(video.passage.start)}`} className="vidx-passage">
            <span className="vidx-ts">{formatClock(video.passage.start)}</span>
            <span className="vidx-passage-text">{markWords(video.passage.text, query)}</span>
          </Link>
        ) : video.summary ? (
          <p className="vidx-summary">{markWords(video.summary, query)}</p>
        ) : null}
      </div>
    </li>
  );
}
