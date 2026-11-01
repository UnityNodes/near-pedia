import type { RelatedItem } from '@/lib/related';
import type { Tone } from '@/lib/status';
import { LinkCards, RelCard } from '@/components/reader-shell';

const TYPE_LABEL: Record<string, string> = {
  cip: 'CIP',
  forum_topic: 'FORUM',
  doc_page: 'DOCS',
  whitepaper: 'PAPER',
  blog_post: 'BLOG',
};
const TYPE_TONE: Record<string, Tone> = {
  cip: 'lime',
  forum_topic: 'info',
  doc_page: 'ok',
  whitepaper: 'mute',
  blog_post: 'mute',
};

export function RelatedPanel({ items }: { items: RelatedItem[] }) {
  if (items.length === 0) return null;

  return (
    <LinkCards title="Related" count={items.length}>
      {items.map(item => (
        <RelCard
          key={`${item.sourceType}:${item.sourceId}`}
          href={item.path}
          tag={TYPE_LABEL[item.sourceType] ?? item.sourceType.toUpperCase()}
          tone={TYPE_TONE[item.sourceType] ?? 'mute'}
          title={item.title}
        />
      ))}
    </LinkCards>
  );
}
