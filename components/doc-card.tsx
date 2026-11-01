import type { ReactNode } from 'react';
import type { DocHit } from '@/lib/docs';
import { docSourceLabel } from '@/lib/docs';
import { DOC_KINDS, docSourceKind, docTrail } from '@/lib/docs-browse';
import type { DocKind } from '@/lib/docs-browse';
import type { Tone } from '@/lib/status';
import { PgRow } from '@/components/page-shell';
import { formatDateLong } from '@/lib/utils';
import { tokenize } from '@/lib/rank';

const KIND_TONE: Record<DocKind, Tone> = { official: 'lime', ecosystem: 'info', code: 'mute' };

export function markWords(text: string, query: string | undefined): ReactNode[] {
  const terms = tokenize(query);
  if (!text || terms.length === 0) return [text];
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const folded = m[0].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (!terms.some(t => folded.startsWith(t))) continue;
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(<mark key={at}>{m[0]}</mark>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function DocCard({ doc, line, query, delay = 0 }: { doc: DocHit; line: string; query?: string; delay?: number }) {
  const label = docSourceLabel(doc.source, doc.url);
  const kind = docSourceKind(doc.source);
  const kindLabel = DOC_KINDS.find(k => k.key === kind)?.label ?? kind;
  const trail = docTrail(doc.breadcrumb, label, doc.title);
  const updated = doc.last_modified ? formatDateLong(doc.last_modified) : undefined;

  return (
    <PgRow
      href={`/docs/${doc.id}`}
      tag={kindLabel}
      tone={KIND_TONE[kind]}
      meta={trail.length > 0 ? `${label} · ${trail.join(' › ')}` : label}
      title={markWords(doc.title ?? '', query)}
      sub={line ? markWords(line, query) : undefined}
      date={updated}
      delay={delay}
    />
  );
}
