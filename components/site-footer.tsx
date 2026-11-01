'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useApp } from '@/components/app-context';
import { SITE } from '@/lib/site.config';

const COLUMNS: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: 'Explore',
    links: [
      { href: '/cips', label: 'CIPs' },
      { href: '/docs', label: 'Docs' },
      { href: '/discussions', label: 'Forum' },
      { href: '/code', label: 'Code' },
      { href: '/whitepapers', label: 'Whitepapers' },
      { href: '/feed', label: 'Feed' },
      { href: '/resources', label: 'Resources' },
      { href: '/trending', label: 'Trending' },
    ],
  },
  {
    title: 'Build',
    links: [
      { href: '/for-ai', label: 'For AI · MCP' },
      { href: '/api/v1/reference', label: 'REST API' },
      { href: '/api/feed/cips', label: 'RSS feeds' },
      { href: '/sources', label: 'Sources' },
    ],
  },
  {
    title: 'Project',
    links: [
      { href: '/ecosystem', label: 'Ecosystem' },
      { href: '/validators', label: 'Validators' },
      { href: '/contact', label: 'Contact' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
];

export function SiteFooter() {
  const { t } = useApp();

  const year = new Date().getFullYear();

  return (
    <footer className="site-footer" aria-label="Site footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Image src={SITE.logo.light} alt={`${SITE.name} logo`} width={44} height={44} className="footer-logo-img footer-logo-light" />
          <Image src={SITE.logo.dark} alt={`${SITE.name} logo`} width={44} height={44} className="footer-logo-img footer-logo-dark" />
          <Link href="/" className="footer-word">{SITE.name}<span>by {SITE.publisher.name}</span></Link>
          <p className="footer-tag">{t.footer_tagline}</p>
          <div className="footer-powered">
            <a href={SITE.publisher.url} target="_blank" rel="noopener noreferrer" className="footer-pub">
              {SITE.publisher.name}
            </a>
            <a href={SITE.publisher.twitter} target="_blank" rel="noopener noreferrer" className="footer-x" aria-label={`${SITE.publisher.name} on X`}>
              X
            </a>
          </div>
        </div>

        <nav className="footer-cols" aria-label="Footer navigation">
          {COLUMNS.map(col => (
            <div key={col.title} className="footer-col">
              <h3 className="footer-col-title">{col.title}</h3>
              <ul>
                {col.links.map(l => (
                  <li key={l.href}>
                    {l.href.startsWith('/api') ? (
                      <a href={l.href}>{l.label}</a>
                    ) : (
                      <Link href={l.href}>{l.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="footer-base">
        <span className="footer-copy">© {year} {SITE.name} · {SITE.tagline}</span>
        <span className="footer-soft">Strictly-necessary cookies only. No tracking.</span>
      </div>
    </footer>
  );
}
