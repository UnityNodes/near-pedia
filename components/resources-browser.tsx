'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { FACTS_TITLE, SEARCH_SUGGESTIONS, linkHost, linkKind, linkMatches } from '@/lib/resources';
import type { LearnFact, ResourceLink, ResourceSection } from '@/lib/resources';
import { EmptyAnimation } from '@/components/resources-empty-animation';
import { KindIcon, SectionIcon } from '@/components/resources-icons';

interface SectionMeta {
  id: ResourceSection;
  title: string;
  tagline: string;
  intro: string;
  color: string;
}

function Card({ link, color }: { link: ResourceLink; color: string }) {
  const internal = link.url.startsWith('/');
  const kind = linkKind(link);
  const inner = (
    <>
      <span className="rs-card-top">
        <span className="rs-icon"><KindIcon kind={kind} /></span>
        <span className="rs-kind">{kind}</span>
        <span className="rs-arrow" aria-hidden="true">{internal ? '→' : '↗'}</span>
      </span>
      <span className="rs-title">{link.title}</span>
      <span className="rs-note">{link.note}</span>
      <span className="rs-host">{linkHost(link.url)}</span>
    </>
  );
  const style = { ['--rs-color' as string]: color } as CSSProperties;
  return internal ? (
    <Link href={link.url} className="pg-card rs-card" style={style}>{inner}</Link>
  ) : (
    <a href={link.url} className="pg-card rs-card" style={style} target="_blank" rel="noopener noreferrer">{inner}</a>
  );
}

export function ResourcesBrowser({ sections, links, facts }: { sections: SectionMeta[]; links: ResourceLink[]; facts: LearnFact[] }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const view = useMemo(() => sections.map(section => {
    const groups: { group: string; links: ResourceLink[] }[] = [];
    for (const link of links.filter(l => l.section === section.id && linkMatches(l, q))) {
      let g = groups.find(x => x.group === link.group);
      if (!g) {
        g = { group: link.group, links: [] };
        groups.push(g);
      }
      g.links.push(link);
    }
    return { section, groups, total: groups.reduce((n, g) => n + g.links.length, 0) };
  }), [sections, links, q]);

  const shown = view.reduce((n, v) => n + v.total, 0);

  return (
    <div className="rs-browser">
      <div className="pg-tools">
        <div className="pg-tools-row">
          <label htmlFor="rsrc-q" className="pg-filter">
            <Search size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="pg-sr">Filter the links</span>
            <input
              id="rsrc-q"
              type="search"
              placeholder={`Filter ${links.length} links: ${SEARCH_SUGGESTIONS.slice(0, 3).join(', ')}...`}
              autoComplete="off"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="rs-try">
          <span className="rs-try-label">Try</span>
          <div className="pg-chips">
            {SEARCH_SUGGESTIONS.map(s => (
              <button
                key={s}
                type="button"
                className={`pg-chip rs-chip${q === s ? ' pg-chip--on' : ''}`}
                onClick={() => setQuery(s)}
                aria-pressed={q === s}
              >
                {s}
              </button>
            ))}
          </div>
          <span className="rs-count" aria-live="polite">
            {q ? `${shown} of ${links.length} links` : `${links.length} links`}
          </span>
        </div>
      </div>

      {shown === 0 ? (
        <div className="rs-empty">
          <EmptyAnimation />
          <p className="rs-empty-text">Nothing matches &quot;{query}&quot;. Try a shorter word, or <button type="button" className="rs-clear" onClick={() => setQuery('')}>clear the filter</button>.</p>
        </div>
      ) : null}

      {view.map(({ section, groups, total }) => total === 0 ? null : (
        <section key={section.id} id={section.id} className="rs-section" style={{ ['--rs-color' as string]: section.color } as CSSProperties}>
          <div className="rs-section-head">
            <span className="rs-icon rs-icon--lg"><SectionIcon id={section.id} /></span>
            <h2 className="rs-section-title">{section.title}</h2>
            <span className="rs-section-tagline">{section.tagline}</span>
            <span className="rs-section-count">{total} {total === 1 ? 'link' : 'links'}</span>
          </div>
          <p className="rs-section-intro">{section.intro}</p>
          {section.id === 'learn' && !q && facts.length > 0 ? (
            <div>
              <div className="rs-group-label">{FACTS_TITLE}</div>
              <ol className="rs-facts">
                {facts.map((f, i) => (
                  <li key={f.id} className="rs-fact">
                    <span className="rs-fact-num">{String(i + 1).padStart(2, '0')}</span>
                    <span className="rs-fact-text">{f.text}</span>
                    <a className="rs-fact-src" href={f.url} target="_blank" rel="noopener noreferrer">{f.sourceTitle} ↗</a>
                  </li>
                ))}
              </ol>
              <p className="rs-facts-note">Each line is checked against its source every week, so it cannot quietly go out of date.</p>
            </div>
          ) : null}
          {groups.map(g => (
            <div key={g.group}>
              <div className="rs-group-label">{g.group}</div>
              <div className="rs-grid">
                {g.links.map(link => <Card key={link.url} link={link} color={section.color} />)}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
