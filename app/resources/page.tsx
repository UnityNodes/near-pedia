import Link from 'next/link';
import type { CSSProperties } from 'react';
import { getDb } from '@/lib/db';
import { SITE } from '@/lib/site.config';
import { pageMetadata } from '@/lib/seo';
import { breadcrumbList, collectionPage } from '@/lib/jsonld';
import { JsonLd } from '@/components/json-ld';
import { PageShell } from '@/components/page-shell';
import { ResourcesBrowser } from '@/components/resources-browser';
import { SectionIcon } from '@/components/resources-icons';
import { LEARN_FACTS, PAGE_LINKS, RESOURCES, RESOURCE_SECTIONS } from '@/lib/resources';
import './design.css';

export const revalidate = 3600;

const PAGE_PATH = '/resources';

export const metadata = pageMetadata({
  title: 'Resources',
  description: `Verified links for the ${SITE.name} community. Every link is checked every week.`,
  path: PAGE_PATH,
});

const SECTION_COLORS: Record<string, string> = {
  start: 'var(--accent-text)',
  build: 'var(--cy)',
  community: 'var(--ok)',
  learn: 'var(--warn)',
};

function lastLinkCheck(): { at: string; clean: boolean } | null {
  try {
    const row = getDb()
      .prepare(`SELECT status, ran_at FROM sync_log WHERE source = 'check-resources' ORDER BY id DESC LIMIT 1`)
      .get() as { status: string; ran_at: string } | undefined;
    return row ? { at: row.ran_at.slice(0, 10), clean: row.status === 'success' } : null;
  } catch {
    return null;
  }
}

function latestRelease(): { repo: string; tag: string; at: string } | null {
  try {
    const row = getDb()
      .prepare(`SELECT repo, tag, published_at FROM github_releases WHERE draft = 0 AND prerelease = 0 AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1`)
      .get() as { repo: string; tag: string; published_at: string } | undefined;
    return row ? { repo: row.repo, tag: row.tag, at: row.published_at.slice(0, 10) } : null;
  } catch {
    return null;
  }
}

export default function ResourcesPage() {
  const release = latestRelease();
  const checked = lastLinkCheck();
  const sections = RESOURCE_SECTIONS.map(s => ({ ...s, color: SECTION_COLORS[s.id] ?? 'var(--accent-text)' }));

  const tiles: { label: string; value: string; sub?: string }[] = [
    ...(release ? [{ label: 'Latest release', value: release.tag, sub: `${release.repo}, ${release.at}` }] : []),
    { label: 'Links', value: String(RESOURCES.length), sub: 'opened every week' },
    ...(checked ? [{ label: 'Last check', value: checked.at, sub: checked.clean ? 'no problems' : 'problems being fixed' }] : []),
  ];

  return (
    <PageShell
      href={PAGE_PATH}
      title="Resources"
      description="The links we would send to a colleague, grouped by what you are doing. Every link is opened every week and its page title is checked, so a link that quietly turns into something else is caught."
      stat={{ value: RESOURCES.length, unit: RESOURCES.length === 1 ? 'link' : 'links' }}
      synced={checked?.at ?? null}
      source="weekly link check"
    >
      <JsonLd payload={breadcrumbList([{ name: 'Home', path: '/' }, { name: 'Resources', path: PAGE_PATH }])} />
      <JsonLd payload={collectionPage({
        name: `${SITE.name} resources`,
        description: `Verified links for the ${SITE.name} community.`,
        path: PAGE_PATH,
        itemCount: RESOURCES.length,
      })} />

      <div className="rs">
        <section aria-label="Right now" className="rs-now">
          <div className="rs-now-head">
            <h2 className="rs-now-title">Right now</h2>
            <span className="rs-live">
              <span className="dp-ping" aria-hidden="true"><span className="dp-ping-ring" /><span className="dp-ping-core" /></span>
              Live data
            </span>
          </div>
          <div className="rs-tiles">
            {tiles.map(t => (
              <div key={t.label} className="rs-tile">
                <span className="rs-tile-label">{t.label}</span>
                <span className="rs-tile-value">{t.value}</span>
                {t.sub ? <span className="rs-tile-sub">{t.sub.split(' ').map((w, i) => <span key={i} className="rs-nw">{w} </span>)}</span> : null}
              </div>
            ))}
          </div>
          <div className="rs-now-foot">
            {PAGE_LINKS.filter(l => l.slot === 'panel-foot').map(l => <Link key={l.href} href={l.href}>{l.label}</Link>)}
          </div>
        </section>

        <nav aria-label="Pick your path" className="rs-paths">
          {sections.map(s => (
            <a key={s.id} href={`#${s.id}`} className="rs-path" style={{ ['--rs-color' as string]: s.color } as CSSProperties}>
              <span className="rs-path-top">
                <span className="rs-icon rs-icon--lg"><SectionIcon id={s.id} /></span>
                <span className="rs-path-label">{s.title}</span>
                <span className="rs-path-count">{RESOURCES.filter(r => r.section === s.id).length} links</span>
              </span>
              <span className="rs-path-tagline">{s.tagline}</span>
              <span className="rs-path-intro">{s.intro}</span>
              <span className="rs-path-go">See the links →</span>
            </a>
          ))}
        </nav>

        <ResourcesBrowser sections={sections} links={RESOURCES} facts={LEARN_FACTS} />

        <p className="rs-foot-note">
          Something wrong or missing? {PAGE_LINKS.filter(l => l.slot === 'note').map(l => <Link key={l.href} href={l.href}>{l.label}</Link>)}. We list only what we have opened
          and checked, so the list is short on purpose.
        </p>
      </div>
    </PageShell>
  );
}
