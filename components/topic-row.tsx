import Link from 'next/link';
import type { ForumTopic } from '@/lib/forum';
import { formatRelativeTime, readableAccentColor } from '@/lib/utils';

export function HeartIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline-block', verticalAlign: '-1px' }}>
      <path d="M12 21s-7.5-4.6-10.2-9.1C.3 9 1 5.6 4 4.2c2.3-1.1 4.7-.3 6 1.6a4.6 4.6 0 0 1 6-1.6c3 1.4 3.7 4.8 2.2 7.7C19.5 16.4 12 21 12 21Z" />
    </svg>
  );
}

export function TopicRow({ topic, delay = 0 }: { topic: ForumTopic; delay?: number }) {
  const views = topic.views >= 1000 ? `${(topic.views / 1000).toFixed(1)}k` : topic.views.toLocaleString();
  return (
    <Link href={`/discussions/${topic.id}`} className="pg-row" style={{ animationDelay: `${delay}ms` }}>
      <div className="pg-row-main">
        <div className="pg-row-top">
          <span className="pg-tag" data-tone="mute">
            <span className="dsc-dot" style={{ background: readableAccentColor(topic.category_color) }} aria-hidden="true" />
            {topic.category_name ?? 'General'}
          </span>
          <span className="pg-row-meta dsc-stats">
            <span>{topic.reply_count} {topic.reply_count === 1 ? 'reply' : 'replies'}</span>
            <span>{views} views</span>
            {topic.like_count > 0 && (
              <span className="dsc-likes"><HeartIcon /> {topic.like_count}<span className="pg-sr"> likes</span></span>
            )}
          </span>
        </div>
        <div className="pg-row-title">{topic.title}</div>
        {topic.last_poster_username && (
          <div className="pg-row-sub">Last post by {topic.last_poster_username}</div>
        )}
      </div>
      <div className="pg-row-end">
        <span className="pg-row-date">{formatRelativeTime(topic.last_post_at)}</span>
        <span className="pg-row-go" aria-hidden="true">→</span>
      </div>
    </Link>
  );
}
