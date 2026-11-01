import type { SortOption } from '@/lib/forum';
import { readableAccentColor } from '@/lib/utils';
import { Chip, ChipRow, ListSearch } from '@/components/list-tools';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'activity', label: 'Activity' },
  { value: 'newest', label: 'Newest' },
  { value: 'discussed', label: 'Replies' },
  { value: 'viewed', label: 'Views' },
];

export function TopicFilters({ categories, currentCategory, currentSort, currentQuery, totalTopics, buildUrl }: {
  categories: { id: number; name: string; color: string | null; topic_count: number }[];
  currentCategory?: number;
  currentSort: SortOption;
  currentQuery?: string;
  totalTopics: number;
  buildUrl: (overrides: { category?: number | null; sort?: SortOption }) => string;
}) {
  return (
    <div className="pg-tools">
      <div className="pg-tools-row">
        <ListSearch
          action="/discussions"
          query={currentQuery}
          label="Search discussions"
          placeholder="Search discussions…"
          carry={{
            category: currentCategory ? String(currentCategory) : undefined,
            sort: currentSort !== 'activity' ? currentSort : undefined,
          }}
        />
        <ChipRow ariaLabel="Sort" label="Sort" nav>
          {SORT_OPTIONS.map(opt => (
            <Chip key={opt.value} href={buildUrl({ sort: opt.value })} on={currentSort === opt.value}>{opt.label}</Chip>
          ))}
        </ChipRow>
      </div>
      <ChipRow ariaLabel="Filter by category">
        <Chip href={buildUrl({ category: null })} on={!currentCategory} count={totalTopics}>All</Chip>
        {categories.map(c => (
          <Chip
            key={c.id}
            href={buildUrl({ category: c.id })}
            on={currentCategory === c.id}
            count={c.topic_count}
            dot={readableAccentColor(c.color)}
          >
            {c.name}
          </Chip>
        ))}
      </ChipRow>
    </div>
  );
}
