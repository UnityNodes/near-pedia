import './design.css';
import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { breadcrumbList, definedTermSet } from '@/lib/jsonld';
import { JsonLd } from '@/components/json-ld';
import { GLOSSARY_KINDS, LEGACY_ANCHORS, REFERENCE_GLOSSARY_URL, getGlossary } from '@/lib/glossary';
import { getGlossaryMentions } from '@/lib/glossary-mentions';
import { GlossaryBrowser } from '@/components/glossary-browser';
import { PageShell, PgList, PgRow } from '@/components/page-shell';
import { getLastSync } from '@/lib/section-counts';
import { formatDateLong } from '@/lib/utils';
import { SITE } from '@/lib/site.config';

export async function generateMetadata(): Promise<Metadata> {
  const { entries } = getGlossary();
  return pageMetadata({
    title: 'Glossary',
    description: `${entries.length} terms from the official and reference glossaries and the site's own, each with its source and the CIPs and docs that use it.`,
    path: '/glossary',
  });
}

export default function GlossaryPage() {
  const { entries, sources, stamp } = getGlossary();
  const mentions = getGlossaryMentions(entries, stamp);
  const count = (k: keyof typeof GLOSSARY_KINDS) => entries.filter(e => e.kind === k).length;
  const own = count('docs') + count('market') + count('site');
  const sourceNote = (s: (typeof sources)[number]) => {
    if (!s.held) return 'Not held yet, so the hand-written terms stand in.';
    if (s.parsed < s.headings) return `${s.parsed} of ${s.headings} entries parsed: the upstream page changed its markup.`;
    const shared = s.url === REFERENCE_GLOSSARY_URL ? s.terms - count('reference') : 0;
    const also = shared > 0 ? `${shared} of them also in the official glossary. ` : '';
    return `${also}Changed upstream ${formatDateLong(s.updated)}.`;
  };

  const breadcrumb = breadcrumbList([
    { name: 'Home', path: '/' },
    { name: 'Glossary', path: '/glossary' },
  ]);
  const termSet = definedTermSet({
    path: '/glossary',
    name: `${SITE.name} glossary`,
    terms: entries.map(e => ({
      id: e.id,
      name: e.term,
      alternateName: e.aliases,
      description: e.blocks.map(b => b.text).join(e.blocks.some(b => b.kind === 'li') ? '; ' : ' '),
    })),
  });

  return (
    <PageShell
      href="/glossary"
      title="Glossary"
      description={`Terms in one place: ${count('official')} from the official glossary and ${count('reference')} more from the reference glossary, kept in sync with them, plus ${own} that this site uses. Each says where its definition comes from and how many CIPs and docs mention it.`}
      stat={{ value: entries.length, unit: entries.length === 1 ? 'term' : 'terms' }}
      synced={getLastSync('doc_pages')}
      source="glossary pages"
    >
      <JsonLd payload={breadcrumb} />
      <JsonLd payload={termSet} />

      <GlossaryBrowser entries={entries} mentions={mentions} kinds={GLOSSARY_KINDS} legacyAnchors={LEGACY_ANCHORS} />

      <section className="gl-sources" aria-labelledby="gl-sources-title">
        <h2 id="gl-sources-title">Where the definitions come from</h2>
        <PgList>
          {sources.map((s, i) => (
            <PgRow
              key={s.url}
              href={s.url}
              external
              tag={`${s.terms} ${s.terms === 1 ? 'term' : 'terms'}`}
              tone={s.held ? 'lime' : 'mute'}
              title={s.label}
              sub={<>{sourceNote(s)}<span className="pg-sr"> (opens in a new tab)</span></>}
              delay={i * 40}
            />
          ))}
        </PgList>
      </section>
    </PageShell>
  );
}
