import Link from 'next/link';
import type { ForumTopic } from '@/lib/forum';
import { formatRelativeTime } from '@/lib/utils';

function swatchColor(hex: string | null): string {
  if (!hex || hex === '000000') return 'var(--fg)';
  return `#${hex}`;
}

export function TopicCard({ topic }: { topic: ForumTopic }) {
  return (
    <Link href={`/discussions/${topic.id}`} className="topic-card">
      <span className="topic-id">#{topic.id}</span>

      {topic.category_name && (
        <div className="topic-cat">
          <span className="swatch" style={{ background: swatchColor(topic.category_color) }} />
          {topic.category_name.toUpperCase()}
        </div>
      )}

      <div className="topic-title">{topic.title}</div>

      <div className="topic-meta">
        <span><b>{topic.reply_count}</b> replies</span>
        <span className="topic-meta-sep">·</span>
        <span><b>{topic.views.toLocaleString()}</b> views</span>
        <span className="topic-meta-sep">·</span>
        <span>{formatRelativeTime(topic.last_post_at)}</span>
      </div>
    </Link>
  );
}
