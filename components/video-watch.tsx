'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import Image from 'next/image';
import { Check, Copy, Play, Search } from 'lucide-react';
import { formatClock, queryTokens, renderTimed, timeLink } from '@/lib/video-transcript';

interface Block {
  start: number;
  text: string;
}

interface VideoWatchProps {
  id: string;
  title: string;
  thumbnail: string | null;
  blocks: Block[];
  paragraphs: string[];
  words: number;
  children?: ReactNode;
}

interface Load {
  at: number;
  n: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlight(text: string, tokens: string[]): ReactNode[] {
  if (tokens.length === 0) return [text];
  const parts = text.split(new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi'));
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

function noopSubscribe(): () => void {
  return () => {};
}

function currentSearch(): string {
  return window.location.search;
}

function serverSearch(): string {
  return '';
}

function markFrom(search: string): number | null {
  const raw = new URLSearchParams(search).get('t');
  const seconds = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function VideoWatch({ id, title, thumbnail, blocks, paragraphs, words, children }: VideoWatchProps) {
  const [load, setLoad] = useState<Load | null>(null);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);

  const search = useSyncExternalStore(noopSubscribe, currentSearch, serverSearch);
  const mark = useMemo(() => markFrom(search), [search]);

  const markedIndex = useMemo(() => {
    if (mark === null) return null;
    let found: number | null = null;
    blocks.forEach((b, i) => {
      if (b.start <= mark) found = i;
    });
    return found;
  }, [mark, blocks]);

  useEffect(() => {
    if (markedIndex === null) return;
    document.getElementById(`vt-${markedIndex}`)?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [markedIndex]);

  const play = useCallback((at: number) => {
    setLoad({ at, n: Date.now() });
    playerRef.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, []);

  const tokens = useMemo(() => queryTokens(query), [query]);
  const visible = useMemo(() => {
    const all = blocks.map((b, index) => ({ ...b, index }));
    return tokens.length === 0 ? all : all.filter(b => tokens.every(t => b.text.toLowerCase().includes(t)));
  }, [blocks, tokens]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(blocks.length > 0 ? renderTimed(blocks) : paragraphs.join('\n\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [blocks, paragraphs]);

  const hasTranscript = blocks.length > 0 || paragraphs.length > 0;
  const startLabel = mark !== null ? formatClock(mark) : null;

  return (
    <>
      <div className="rd-player" ref={playerRef}>
        {load ? (
          <iframe
            key={load.n}
            src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&start=${load.at}`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button type="button" className="rd-poster" onClick={() => play(mark ?? 0)}>
            {thumbnail ? <Image src={thumbnail} alt="" fill sizes="(max-width: 1100px) 100vw, 760px" style={{ objectFit: 'cover' }} priority /> : null}
            <span className="rd-play">
              <Play size={20} strokeWidth={1.75} fill="currentColor" aria-hidden="true" />
              {startLabel ? `Play from ${startLabel}` : 'Play video'}
            </span>
          </button>
        )}
      </div>
      <p className="rd-privacy">Nothing is loaded from YouTube until you press play, and then without tracking cookies.</p>

      {children}

      {hasTranscript ? (
        <section className="rd-tx" aria-labelledby="rd-tx-title">
          <div className="rd-tx-head">
            <h2 id="rd-tx-title" className="rd-h2">Transcript</h2>
            <span className="rd-tx-count">{words.toLocaleString('en-US')} words</span>
            <button type="button" className="pg-btn pg-btn--line rd-btn-sm rd-tx-copy" onClick={copy}>
              {copied ? <Check size={14} strokeWidth={1.75} aria-hidden="true" /> : <Copy size={14} strokeWidth={1.75} aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="rd-tx-note">Captions as YouTube publishes them, usually machine-generated, so product and people names can be misheard.</p>
          {blocks.length > 0 ? (
            <label className="pg-filter rd-tx-search">
              <Search size={16} strokeWidth={1.75} aria-hidden="true" />
              <span className="pg-sr">Search this transcript</span>
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search this transcript"
                autoComplete="off"
              />
              {tokens.length > 0 ? <span className="rd-tx-hits" role="status">{visible.length} of {blocks.length}</span> : null}
            </label>
          ) : null}
          {blocks.length > 0 ? (
            visible.length > 0 ? (
              <ol className="rd-tx-list">
                {visible.map(b => (
                  <li key={b.index} id={`vt-${b.index}`} className={b.index === markedIndex ? 'rd-tx-row is-marked' : 'rd-tx-row'}>
                    <a
                      href={timeLink(id, b.start)}
                      className="rd-tx-time"
                      onClick={e => {
                        e.preventDefault();
                        play(b.start);
                      }}
                      aria-label={`Play from ${formatClock(b.start)}`}
                    >
                      {formatClock(b.start)}
                    </a>
                    <p>{highlight(b.text, tokens)}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rd-tx-empty">No part of this transcript mentions “{query.trim()}”.</p>
            )
          ) : (
            <div className="rd-tx-plain">
              {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
