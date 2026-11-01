'use client';

import Link from 'next/link';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { ExternalLink, Hash, Search, X } from 'lucide-react';
import type { GlossaryEntry, GlossaryKind } from '@/lib/glossary';
import type { TermMentions } from '@/lib/glossary-mentions';
import type { Tone } from '@/lib/status';
import { EmptyAnimation } from '@/components/resources-empty-animation';

export interface GlossaryBrowserProps {
  entries: GlossaryEntry[];
  mentions: Record<string, TermMentions>;
  kinds: Record<GlossaryKind, { label: string; hint: string }>;
  legacyAnchors: Record<string, string>;
}

const KIND_TONE: Record<GlossaryKind, Tone> = {
  official: 'lime',
  reference: 'info',
  docs: 'ok',
  market: 'mute',
  site: 'mute',
};

export function letterOf(term: string): string {
  const c = term.replace(/^[^A-Za-z0-9]+/, '').charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

function letterId(letter: string): string {
  return `letter-${letter === '#' ? 'num' : letter.toLowerCase()}`;
}

export function matchesTerm(e: GlossaryEntry, q: string): boolean {
  if (!q) return true;
  const hay = [e.term, ...e.aliases, ...e.blocks.map(b => b.text), ...e.alsoIn.flatMap(a => a.blocks.map(b => b.text))].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

function nameRank(e: GlossaryEntry, q: string): number {
  const l = q.toLowerCase();
  const names = [e.term, ...e.aliases].map(n => n.toLowerCase());
  if (names.some(n => n === l)) return 0;
  if (names.some(n => n.startsWith(l))) return 1;
  if (names.some(n => n.includes(l))) return 2;
  return 3;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function readHash() {
  return window.location.hash;
}

function readServerHash() {
  return '';
}

function Term({ e, mentions, kinds, legacy, onJump }: { e: GlossaryEntry; mentions?: TermMentions; kinds: GlossaryBrowserProps['kinds']; legacy: string[]; onJump: (id: string, ev: ReactMouseEvent<HTMLAnchorElement>) => void }) {
  const external = e.source && /^https?:/.test(e.source.url);
  return (
    <article id={e.id} className="pg-card gl-card" aria-labelledby={`${e.id}-name`}>
      {legacy.map(id => <span key={id} id={id} className="gl-legacy" aria-hidden="true" />)}
      <header className="gl-head">
        <h3 id={`${e.id}-name`} className="gl-name">{e.term}</h3>
        <a href={`#${e.id}`} className="gl-perma" aria-label={`Link to ${e.term}`}><Hash size={14} strokeWidth={1.75} aria-hidden="true" /></a>
      </header>
      <div className="gl-meta">
        <span className="pg-tag" data-tone={KIND_TONE[e.kind]} data-kind={e.kind} title={kinds[e.kind].hint}>{kinds[e.kind].label}</span>
        {e.aliases.length > 0 ? <p className="gl-alias">Also called {e.aliases.join(', ')}</p> : null}
      </div>
      <Blocks blocks={e.blocks} />
      {e.alsoIn.map(a => (
        <div key={a.url} className="gl-also">
          <span className="gl-also-label">The {a.label} puts it differently</span>
          <Blocks blocks={a.blocks} />
        </div>
      ))}
      <footer className="gl-foot">
        {e.related.length > 0 ? (
          <div className="gl-related">
            <span className="gl-foot-label">Related</span>
            {e.related.map(r => <a key={r.id} href={`#${r.id}`} className="gl-rel" onClick={ev => onJump(r.id, ev)}>{r.term}</a>)}
          </div>
        ) : null}
        <div className="gl-links">
          {mentions && mentions.cips > 0 ? (
            <Link href={`/cips?q=${encodeURIComponent(mentions.query)}`} className="gl-link gl-count">{plural(mentions.cips, 'CIP', 'CIPs')}</Link>
          ) : null}
          {mentions && mentions.docs > 0 ? (
            <Link href={`/docs?q=${encodeURIComponent(mentions.query)}`} className="gl-link gl-count">{plural(mentions.docs, 'doc', 'docs')}</Link>
          ) : null}
          {e.source ? (
            external ? (
              <a href={e.source.url} target="_blank" rel="noopener noreferrer" className="gl-link">
                {e.source.label}<ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" /><span className="pg-sr"> (opens in a new tab)</span>
              </a>
            ) : (
              <Link href={e.source.url} className="gl-link gl-count">{e.source.label}</Link>
            )
          ) : null}
        </div>
      </footer>
    </article>
  );
}

function Blocks({ blocks }: { blocks: GlossaryEntry['blocks'] }) {
  const out: ReactNode[] = [];
  let items: string[] = [];
  const flush = (key: number) => {
    if (items.length) out.push(<ul key={`ul-${key}`} className="gl-list">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>);
    items = [];
  };
  blocks.forEach((b, i) => {
    if (b.kind === 'li') { items.push(b.text); return; }
    flush(i);
    out.push(<p key={i} className="gl-def">{b.text}</p>);
  });
  flush(blocks.length);
  return <>{out}</>;
}

export function GlossaryBrowser({ entries, mentions, kinds, legacyAnchors }: GlossaryBrowserProps) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<GlossaryKind | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const hash = useSyncExternalStore(subscribeHash, readHash, readServerHash);
  const q = query.trim();

  const jump = (id: string, ev: ReactMouseEvent<HTMLAnchorElement>) => {
    if (document.getElementById(id)) return;
    ev.preventDefault();
    flushSync(() => {
      setQuery('');
      setKind(null);
    });
    if (window.location.hash === `#${id}`) document.getElementById(id)?.scrollIntoView();
    else window.location.hash = id;
  };

  const legacyFor = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const [from, to] of Object.entries(legacyAnchors)) (m[to] ??= []).push(from);
    return m;
  }, [legacyAnchors]);

  const kindCounts = useMemo(() => {
    const c = {} as Record<GlossaryKind, number>;
    for (const e of entries) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [entries]);

  const shown = useMemo(() => {
    const list = entries.filter(e => (!kind || e.kind === kind) && matchesTerm(e, q));
    return q ? [...list].sort((a, b) => nameRank(a, q) - nameRank(b, q)) : list;
  }, [entries, kind, q]);

  const groups = useMemo(() => {
    if (q) return [{ letter: '', items: shown }];
    const m = new Map<string, GlossaryEntry[]>();
    for (const e of shown) {
      const l = letterOf(e.term);
      m.set(l, [...(m.get(l) ?? []), e]);
    }
    return [...m.entries()].map(([letter, items]) => ({ letter, items }));
  }, [shown, q]);

  const letters = useMemo(() => [...new Set(entries.map(e => letterOf(e.term)))], [entries]);
  const present = new Set(groups.map(g => g.letter));

  return (
    <div className="gl">
      <div className="pg-tools">
        <div className="pg-tools-row">
          <div className="pg-filter" role="search">
            <Search size={18} strokeWidth={1.75} aria-hidden="true" />
            <label htmlFor="gl-q" className="pg-sr">Filter terms</label>
            <input
              id="gl-q"
              ref={input}
              type="search"
              value={query}
              onChange={ev => setQuery(ev.target.value)}
              placeholder={`Filter ${entries.length} terms by name, abbreviation or definition`}
              autoComplete="off"
            />
            {query ? (
              <button type="button" className="gl-clear" onClick={() => { setQuery(''); input.current?.focus(); }} aria-label="Clear the filter"><X size={16} strokeWidth={1.75} aria-hidden="true" /></button>
            ) : null}
          </div>
        </div>
        <div className="pg-tools-row">
          <span className="gl-label">Kind</span>
          <div className="pg-chips" role="group" aria-label="Kind of term">
            <button type="button" className={`pg-chip${!kind ? ' pg-chip--on' : ''}`} aria-pressed={!kind} onClick={() => setKind(null)}>All<b className="gl-n">{entries.length}</b></button>
            {(Object.keys(kinds) as GlossaryKind[]).filter(k => kindCounts[k]).map(k => (
              <button key={k} type="button" className={`pg-chip${kind === k ? ' pg-chip--on' : ''}`} aria-pressed={kind === k} title={kinds[k].hint} onClick={() => setKind(kind === k ? null : k)}>
                {kinds[k].label}<b className="gl-n">{kindCounts[k]}</b>
              </button>
            ))}
          </div>
        </div>
      </div>

      {!q ? (
        <nav className="gl-letters" aria-label="Jump to a letter">
          {letters.map(l => {
            if (!present.has(l)) return <span key={l} className="gl-letter gl-letter--none" aria-hidden="true">{l}</span>;
            const on = hash === `#${letterId(l)}`;
            return <a key={l} href={`#${letterId(l)}`} className={`gl-letter${on ? ' gl-letter--on' : ''}`} aria-current={on ? 'location' : undefined}>{l}</a>;
          })}
        </nav>
      ) : null}

      {shown.length === 0 ? (
        <div className="pg-list">
          <div className="pg-empty gl-empty">
            <EmptyAnimation />
            <p>No term matches “{q}”{kind ? <> in {kinds[kind].label}</> : null}.</p>
            <div className="gl-actions">
              {kind ? <button type="button" className="pg-chip" onClick={() => setKind(null)}>Every kind</button> : null}
              <Link href={`/search?q=${encodeURIComponent(q)}`} className="pg-chip">Search the whole site for “{q}”</Link>
            </div>
          </div>
        </div>
      ) : (
        groups.map(g => (
          <section key={g.letter || 'results'} className="gl-group" aria-labelledby={g.letter ? letterId(g.letter) : undefined}>
            {g.letter ? <h2 id={letterId(g.letter)} className="gl-group-head">{g.letter}</h2> : <h2 className="pg-sr">Matching terms</h2>}
            <div className="pg-cards gl-grid">
              {g.items.map(e => <Term key={e.id} e={e} mentions={mentions[e.id]} kinds={kinds} legacy={legacyFor[e.id] ?? []} onJump={jump} />)}
            </div>
          </section>
        ))
      )}

      <div className="pg-foot">
        <span aria-live="polite">Showing {shown.length.toLocaleString('en-US')} of {entries.length.toLocaleString('en-US')}<span className="pg-sr"> terms</span></span>
        <Link href="/search">Search all sources →</Link>
      </div>
    </div>
  );
}
