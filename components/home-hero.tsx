'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Code2, Compass, Search } from 'lucide-react';

const PHRASES = [
  'Is near-sdk-js still maintained?',
  'DelegateV2 meta transactions',
  'near-api-js 7 migration',
  'storage_deposit',
];

const CHIPS = ['near-sdk-js', 'DelegateV2', 'House of Stake', 'protocol upgrade'];

const STATIC_PLACEHOLDER = 'Search docs, releases, deprecations, forum…';

function useTypedPlaceholder(): string {
  const [text, setText] = useState(STATIC_PLACEHOLDER);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let phrase = 0;
    let chars = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const full = PHRASES[phrase];
      if (!deleting) {
        chars += 1;
        setText(full.slice(0, chars));
        if (chars === full.length) {
          deleting = true;
          timer = setTimeout(step, 1700);
          return;
        }
        timer = setTimeout(step, 55);
      } else {
        chars -= 1;
        setText(full.slice(0, chars) || ' ');
        if (chars === 0) {
          deleting = false;
          phrase = (phrase + 1) % PHRASES.length;
          timer = setTimeout(step, 350);
          return;
        }
        timer = setTimeout(step, 28);
      }
    };
    timer = setTimeout(step, 600);
    return () => clearTimeout(timer);
  }, []);
  return text;
}

export function HomeHero({
  sourceCount,
  headline,
  panel,
}: {
  sourceCount: number;
  headline: string;
  panel: ReactNode;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const placeholder = useTypedPlaceholder();
  const glowRef = useRef<HTMLDivElement>(null);

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  const onMove = (e: React.MouseEvent<HTMLElement>) => {
    const glow = glowRef.current;
    if (!glow) return;
    const rect = e.currentTarget.getBoundingClientRect();
    glow.style.left = `${((e.clientX - rect.left) / rect.width) * 100}%`;
    glow.style.top = `${((e.clientY - rect.top) / rect.height) * 100}%`;
  };

  return (
    <section className="dp-hero" onMouseMove={onMove} aria-label="Introduction and search">
      <div className="dp-blob" aria-hidden="true" />
      <div className="dp-glow" ref={glowRef} aria-hidden="true" />
      <div className="dp-hero-in">
        <div className="dp-hero-left">
          {sourceCount > 0 && (
            <Link href="/sources" className="dp-badge dp-rise" style={{ animationDelay: '.05s' }}>
              <span className="dp-ping" aria-hidden="true">
                <span className="dp-ping-ring" />
                <span className="dp-ping-core" />
              </span>
              {sourceCount} of {sourceCount} sources syncing
            </Link>
          )}
          <h1 className="dp-h1 dp-rise" style={{ animationDelay: '.12s' }}>
            What <span className="dp-shine">{headline}</span> looks like today.
          </h1>
          <p className="dp-lede dp-rise" style={{ animationDelay: '.2s' }}>
            NEAR moves faster than anyone&apos;s memory. NEARpedia tracks what it removed, deprecated, changed and
            voted on, for the agents writing NEAR code and the people researching NEAR, with a source and a date on
            every answer.
          </p>
          <nav className="dp-doors dp-rise" style={{ animationDelay: '.24s' }} aria-label="Choose how you use NEARpedia">
            <Link href="/for-ai" className="dp-door">
              <span className="dp-door-k"><Code2 size={14} aria-hidden="true" />I write NEAR code</span>
              <b>Check code before it breaks</b>
              <span className="dp-door-d">Connect your agent over MCP: it learns what NEAR removed and what replaced it.</span>
              <span className="dp-door-go">Connect an agent →</span>
            </Link>
            <Link href="/ask" className="dp-door">
              <span className="dp-door-k"><Compass size={14} aria-hidden="true" />I&apos;m researching NEAR</span>
              <b>Ask what is going on</b>
              <span className="dp-door-d">Upgrades, House of Stake votes, incidents and projects, answered from the sources.</span>
              <span className="dp-door-go">Ask a question →</span>
            </Link>
          </nav>
          <form
            className="dp-search dp-rise"
            style={{ animationDelay: '.28s' }}
            onSubmit={(e) => { e.preventDefault(); submit(query); }}
          >
            <Search size={18} aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              aria-label="Search the index"
            />
            <button type="submit" aria-label="Search">→</button>
          </form>
          <div className="dp-chips dp-rise" style={{ animationDelay: '.34s' }}>
            {CHIPS.map((c) => (
              <button key={c} type="button" className="dp-chip" onClick={() => submit(c)}>{c}</button>
            ))}
          </div>
          <ul className="dp-promises dp-rise" style={{ animationDelay: '.46s' }}>
            <li><span aria-hidden="true">↳</span>Every answer cites its source</li>
            <li><span aria-hidden="true">↻</span>Re-synced 5 min – 24 h</li>
            <li><span aria-hidden="true">◇</span>MCP + REST, no key</li>
          </ul>
        </div>
        <div className="dp-hero-right dp-rise" style={{ animationDelay: '.2s' }}>{panel}</div>
      </div>
    </section>
  );
}
