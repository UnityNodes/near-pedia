'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export function CipTypeFilter({ types, currentType }: {
  types: string[];
  currentType?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) { params.set('type', value); } else { params.delete('type'); }
    params.set('page', '1');
    router.push(`/cips?${params.toString()}`);
  };

  return (
    <select
      value={currentType ?? ''}
      onChange={e => handleChange(e.target.value)}
      className="cp-select"
      aria-label="Filter by type"
    >
      <option value="">All types</option>
      {types.map(t => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}
