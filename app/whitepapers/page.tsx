import Link from 'next/link';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { getAllWhitepapers } from '@/lib/whitepapers';
import { FOUNDATIONAL_SLUG, newestFirst, paperFacts } from '@/lib/whitepaper-meta';
import { pageMetadata } from '@/lib/seo';
import { getLastSync } from '@/lib/section-counts';
import { EmptyAnimation } from '@/components/resources-empty-animation';
import { PageShell, PgFoot, PgList, PgRow } from '@/components/page-shell';

export const revalidate = 300;

export const metadata = pageMetadata({
  title: 'Whitepapers',
  description: 'YourChain whitepapers and research papers, each as full text with a link to the original.',
  path: '/whitepapers',
});

export default function WhitepapersPage() {
  const all = getAllWhitepapers();
  const papers = newestFirst(all);
  const founding = all.find(wp => wp.slug === FOUNDATIONAL_SLUG);
  const start = founding ? paperFacts(founding) : null;

  return (
    <PageShell
      href="/whitepapers"
      title="Whitepapers"
      description="The whitepapers and research written about YourChain. Each opens here as full text and links to the original."
      stat={{ value: papers.length, unit: papers.length === 1 ? 'paper' : 'papers' }}
      synced={getLastSync('whitepapers')}
      source="whitepapers"
    >
      {founding && start ? (
        <section className="pg-feature" aria-labelledby="wpx-start">
          <h2 id="wpx-start">Start with the founding paper</h2>
          <Link href={`/whitepapers/${founding.slug}`} className="pg-feature-title">{founding.title}</Link>
          <span className="pg-feature-meta">
            <span>{start.publisher}</span>
            {start.dateLabel ? <><span aria-hidden="true">·</span><time dateTime={start.date ?? undefined}>{start.dateLabel}</time></> : null}
            {start.isPdf && founding.pages ? <><span aria-hidden="true">·</span><span>{founding.pages} pages</span></> : null}
          </span>
          {start.description ? <p>{start.description}</p> : null}
          <div className="pg-actions">
            <Link href={`/whitepapers/${founding.slug}`} className="pg-btn">
              Read it here<ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
            </Link>
            <a href={founding.pdf_url} target="_blank" rel="noopener noreferrer" className="pg-btn pg-btn--line">
              {start.sourceAction}<ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
              <span className="pg-sr"> on {start.sourceHost} (opens in a new tab)</span>
            </a>
          </div>
        </section>
      ) : null}

      <PgList
        empty={papers.length === 0 ? (
          <div className="pg-empty">
            <EmptyAnimation />
            <p>No papers held yet. The whitepapers sync fills this page.</p>
          </div>
        ) : null}
      >
        {papers.map((wp, i) => {
          const f = paperFacts(wp);
          return (
            <PgRow
              key={wp.slug}
              href={`/whitepapers/${wp.slug}`}
              tag={f.publisher}
              title={wp.title}
              sub={f.description || undefined}
              date={f.dateLabel ?? 'Undated'}
              delay={i * 40}
            />
          );
        })}
      </PgList>
      <PgFoot shown={papers.length} total={papers.length} />
    </PageShell>
  );
}
