'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ChevronDown, Moon, Search, Sun } from 'lucide-react';
import { useApp } from '@/components/app-context';
import { SearchOverlay } from '@/components/search-overlay';
import { useEffect, useRef, useState } from 'react';
import { SITE } from '@/lib/site.config';
import { NAV_GROUPS, type NavItem } from '@/lib/nav-groups';

function MobileMenu({
  onClose,
  groups,
}: {
  onClose: () => void;
  groups: { label: string; items: NavItem[] }[];
}) {
  const pathname = usePathname();
  const { t } = useApp();

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="mobile-menu-overlay" onClick={onClose}>
      <div className="mobile-menu" onClick={e => e.stopPropagation()}>
        <div className="mobile-menu-header">
          <span className="mobile-menu-title">{t.nav_menu}</span>
          <button className="mobile-menu-close" onClick={onClose} aria-label="Close menu">✕</button>
        </div>
        <nav className="mobile-nav">
          <Link
            href="/check"
            className={`mobile-nav-item${pathname.startsWith('/check') ? ' active' : ''}`}
            onClick={onClose}
          >
            Check code
          </Link>
          <Link
            href="/deprecations"
            className={`mobile-nav-item${pathname.startsWith('/deprecations') ? ' active' : ''}`}
            onClick={onClose}
          >
            Deprecations
          </Link>
          <Link
            href="/ask"
            className={`mobile-nav-item${pathname.startsWith('/ask') ? ' active' : ''}`}
            onClick={onClose}
          >
            Ask
          </Link>
          {groups.map(group => (
            <div key={group.label}>
              <div className="mobile-nav-group-label">{group.label}</div>
              {group.items.map(({ href, label, Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`mobile-nav-item indent${pathname.startsWith(href) ? ' active' : ''}`}
                  onClick={onClose}
                >
                  <Icon size={15} aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </div>
          ))}
          <Link
            href="/for-ai"
            className={`mobile-nav-item${pathname.startsWith('/for-ai') ? ' active' : ''}`}
            onClick={onClose}
          >
            {t.nav_for_ai}
          </Link>
        </nav>
      </div>
    </div>
  );
}

function NavDropdown({
  label,
  items,
  isGroupActive,
}: {
  label: string;
  items: NavItem[];
  isGroupActive: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  return (
    <div ref={ref} className={`nav-group${open ? ' open' : ''}`}>
      <button
        className={`nav-group-btn${isGroupActive ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className="nav-label">{label}</span>
        <ChevronDown className="nav-caret" size={14} aria-hidden="true" />
      </button>
      <div className="nav-dropdown" role="menu">
        <div className="nav-dropdown-label">{label}</div>
        {items.map(({ href, label: itemLabel, hint, Icon }, i) => (
          <Link
            key={href}
            href={href}
            className={pathname.startsWith(href) ? 'active' : ''}
            onClick={() => setOpen(false)}
            role="menuitem"
            style={{ animationDelay: `${i * 30}ms` }}
          >
            <span className="nav-item-icon"><Icon size={16} aria-hidden="true" /></span>
            <span className="nav-item-text">
              <span className="nav-item-title">{itemLabel}</span>
              <span className="nav-item-hint">{hint}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function Topbar() {
  const pathname = usePathname();
  const { theme, toggleTheme, t } = useApp();
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const groups = NAV_GROUPS.filter(g => g.key !== 'check' && g.key !== 'build');

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <Image src={SITE.logo.light} alt={SITE.name} width={136} height={26} className="brand-logo brand-logo-light" priority unoptimized />
            <Image src={SITE.logo.dark} alt={SITE.name} width={136} height={26} className="brand-logo brand-logo-dark" priority unoptimized />
            <span className="brand-sub">by {SITE.publisher.name}</span>
          </Link>

          <nav className="nav-list">
            <Link href="/check" className={pathname.startsWith('/check') ? 'active' : ''}>
              <span className="nav-label">Check code</span>
            </Link>
            <Link href="/deprecations" className={pathname.startsWith('/deprecations') ? 'active' : ''}>
              <span className="nav-label">Deprecations</span>
            </Link>
            <Link href="/ask" className={pathname.startsWith('/ask') ? 'active' : ''}>
              <span className="nav-label">Ask</span>
            </Link>
            {groups.map(group => (
              <NavDropdown
                key={group.label}
                label={group.label}
                items={group.items}
                isGroupActive={group.items.some(i => pathname.startsWith(i.href))}
              />
            ))}
            <Link
              href="/for-ai"
              className={`nav-pushed-right${pathname.startsWith('/for-ai') ? ' active' : ''}`}
            >
              <span className="nav-label">{t.nav_for_ai}</span>
            </Link>
          </nav>

          <div className="top-actions">
            <button className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Open search (press /)" aria-keyshortcuts="/">
              <span className="prompt" aria-hidden="true">{'>'}</span>
              <span>{t.nav_search}_</span>
              <span className="kbd" aria-hidden="true">/</span>
            </button>

            <button className="icon-btn mobile-search-btn" onClick={() => setSearchOpen(true)} aria-label="Search">
              <Search size={16} aria-hidden="true" />
            </button>

            <button className="icon-btn" onClick={toggleTheme} title="Toggle theme" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>

            <button
              className="hamburger-btn"
              onClick={() => setMobileOpen(o => !o)}
              aria-label="Open menu"
              aria-expanded={mobileOpen}
            >
              <span className="hamburger-line" />
              <span className="hamburger-line" />
              <span className="hamburger-line" />
            </button>
          </div>
        </div>
      </div>

      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
      {mobileOpen && <MobileMenu onClose={() => setMobileOpen(false)} groups={groups} />}
    </>
  );
}
