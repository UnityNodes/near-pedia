export const CIP_PER_PAGE = 20;

export const IN_PROGRESS_STATUSES = ['Draft', 'Proposed', 'In Review'] as const;

export const CIP_SEARCH_SUGGESTIONS = ['validator', 'governance', 'token', 'upgrade'];

interface StatusCount {
  status: string;
  count: number;
}

export function inProgress(counts: StatusCount[]): { total: number; parts: StatusCount[] } {
  const parts = IN_PROGRESS_STATUSES
    .map(status => counts.find(c => c.status === status))
    .filter((c): c is StatusCount => c !== undefined);
  return { total: parts.reduce((n, p) => n + p.count, 0), parts };
}

export interface ActiveFilter {
  key: 'q' | 'status' | 'type';
  label: string;
  value: string;
}

export function activeFilters(params: { q?: string; status?: string; type?: string }): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  if (params.q && params.q.trim()) out.push({ key: 'q', label: 'Search', value: params.q.trim() });
  if (params.status) out.push({ key: 'status', label: 'Status', value: params.status });
  if (params.type) out.push({ key: 'type', label: 'Type', value: params.type });
  return out;
}

export function pageWindow(page: number, shown: number, total: number): { from: number; to: number } {
  if (shown <= 0 || total <= 0) return { from: 0, to: 0 };
  const from = (page - 1) * CIP_PER_PAGE + 1;
  return { from, to: Math.min(from + shown - 1, total) };
}

export function cipLabel(num: number | null, id: string | number): string {
  if (num) return `CIP-${String(num).padStart(4, '0')}`;
  return String(id).startsWith('PR-') ? String(id) : `PR-${id}`;
}
