import Link from 'next/link';
import { docSourceLabel } from '@/lib/docs';
import type { DocSourceCount } from '@/lib/docs';
import { splitSources } from '@/lib/docs-browse';

function Pill({ s, currentSource, buildUrl }: { s: DocSourceCount; currentSource?: string; buildUrl: (source?: string) => string }) {
  const active = currentSource === s.source;
  return (
    <Link href={buildUrl(s.source)} className={`pg-chip${active ? ' pg-chip--on' : ''}`} aria-current={active ? 'true' : undefined}>
      {docSourceLabel(s.source, s.url)}<b className="dx-n">{s.count.toLocaleString('en-US')}</b>
    </Link>
  );
}

export function DocSourceFilter({ sources, currentSource, buildUrl }: {
  sources: DocSourceCount[];
  currentSource?: string;
  buildUrl: (source?: string) => string;
}) {
  const total = sources.reduce((n, s) => n + s.count, 0);
  const { main, more } = splitSources(sources, currentSource);

  return (
    <div className="dx-sources">
      <div className="pg-tools-row">
        <span className="dx-label" aria-hidden="true">Source</span>
        <div className="pg-chips" role="group" aria-label="Filter by source">
          <Link href={buildUrl(undefined)} className={`pg-chip${!currentSource ? ' pg-chip--on' : ''}`} aria-current={!currentSource ? 'true' : undefined}>
            All sources<b className="dx-n">{total.toLocaleString('en-US')}</b>
          </Link>
          {main.map(s => <Pill key={s.source} s={s} currentSource={currentSource} buildUrl={buildUrl} />)}
        </div>
      </div>
      {more.length > 0 ? (
        <details className="dx-more">
          <summary>
            {more.length} more {more.length === 1 ? 'source' : 'sources'}
            <span className="dx-more-count">{more.reduce((n, s) => n + s.count, 0).toLocaleString('en-US')} pages</span>
          </summary>
          <div className="pg-chips" role="group" aria-label="More sources">
            {more.map(s => <Pill key={s.source} s={s} currentSource={currentSource} buildUrl={buildUrl} />)}
          </div>
        </details>
      ) : null}
    </div>
  );
}
