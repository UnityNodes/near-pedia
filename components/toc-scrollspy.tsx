'use client';

import { useEffect } from 'react';

const ACTIVE_LINE_PX = 96;

export function TocScrollspy({ contentSelector }: { contentSelector: string }) {
  useEffect(() => {
    const content = document.querySelector(contentSelector);
    if (!content) return;

    const headings = Array.from(content.querySelectorAll('h2[id], h3[id]')) as HTMLElement[];
    if (headings.length === 0) return;

    const tocLinks = Array.from(document.querySelectorAll('.doc-toc-item')) as HTMLAnchorElement[];
    if (tocLinks.length === 0) return;

    function getActiveId(): string | null {
      const nearBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 80;
      if (nearBottom) return headings[headings.length - 1].id;

      let activeId: string | null = null;
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= ACTIVE_LINE_PX) {
          activeId = h.id;
        } else {
          break;
        }
      }
      return activeId;
    }

    let rafId = 0;
    let lastActiveId: string | null = null;

    function update() {
      const activeId = getActiveId();
      if (activeId === lastActiveId) return;
      lastActiveId = activeId;
      tocLinks.forEach(link => {
        const isActive = activeId ? link.getAttribute('href') === `#${activeId}` : false;
        link.classList.toggle('active', isActive);
        if (isActive) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }

    function onScroll() {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    update();

    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId);
    };
  }, [contentSelector]);

  return null;
}
