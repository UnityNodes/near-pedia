'use client';

import { useEffect, useState } from 'react';

interface Heading {
  level: number;
  text: string;
  slug: string;
}

export function CipToc({ headings }: { headings: Heading[] }) {
  const [activeSlug, setActiveSlug] = useState('');

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    headings.forEach(({ slug }) => {
      const el = document.getElementById(slug);
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveSlug(slug); },
        { rootMargin: '0px 0px -75% 0px' }
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach(o => o.disconnect());
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav className="doc-toc" aria-label="Contents">
      {headings.map(({ level, text, slug }) => {
        const on = activeSlug === slug;
        return (
          <a
            key={slug}
            href={`#${slug}`}
            className={on ? 'doc-toc-item active' : 'doc-toc-item'}
            data-level={level}
            aria-current={on ? 'location' : undefined}
          >
            <span className="rd-toc-text">{text}</span>
          </a>
        );
      })}
    </nav>
  );
}
