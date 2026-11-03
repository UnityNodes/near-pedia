'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useApp } from '@/components/app-context';
import { SITE } from '@/lib/site.config';

const COLUMNS: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: 'Explore',
    links: [
      { href: '/deprecations', label: 'Deprecations' },
      { href: '/radar', label: 'Radar' },
      { href: '/protocol', label: 'Protocol' },
      { href: '/governance', label: 'Governance' },
      { href: '/ask', label: 'Ask' },
      { href: '/docs', label: 'Docs' },
      { href: '/releases', label: 'Releases' },
      { href: '/discussions', label: 'Forum' },
      { href: '/feed', label: 'Feed' },
    ],
  },
  {
    title: 'Build',
    links: [
      { href: '/for-ai', label: 'For AI · MCP' },
      { href: '/api/v1/reference', label: 'REST API' },
      { href: '/api/v1/openapi.json', label: 'OpenAPI' },
      { href: '/sources', label: 'Sources' },
    ],
  },
  {
    title: 'Project',
    links: [
      { href: '/ecosystem', label: 'Ecosystem' },
      { href: '/code', label: 'Code' },
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
          <Link href="/" className="footer-word" aria-label={SITE.name}>
            <Image src={SITE.logo.light} alt="" width={177} height={34} className="footer-logo-img footer-logo-light" unoptimized />
            <Image src={SITE.logo.dark} alt="" width={177} height={34} className="footer-logo-img footer-logo-dark" unoptimized />
            <span>by {SITE.publisher.name}</span>
          </Link>
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
