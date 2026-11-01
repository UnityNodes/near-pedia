import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_AGE_DAYS, RESOURCES, RESOURCE_SECTIONS, ageInDays, evidenceFound, LEARN_FACTS, linkHost, linkKind, linkMatches, PAGE_LINKS, resourcesBySection, SEARCH_SUGGESTIONS } from '../../lib/resources';

describe('resources', () => {
  it('lists every link once', () => {
    const urls = RESOURCES.map(r => r.url.replace(/\/$/, '').toLowerCase());
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('uses https for every external link', () => {
    for (const r of RESOURCES.filter(x => !x.url.startsWith('/'))) {
      expect(new URL(r.url).protocol, r.url).toBe('https:');
    }
  });

  it('points every internal link at a page that exists', () => {
    for (const r of RESOURCES.filter(x => x.url.startsWith('/'))) {
      const base = path.join(process.cwd(), 'app', r.url.replace(/^\//, ''));
      const found = ['page.tsx', 'page.ts', 'route.ts', 'route.tsx'].some(f => fs.existsSync(path.join(base, f)));
      expect(found, r.url).toBe(true);
    }
  });

  it('gives every section at least one link', () => {
    for (const s of RESOURCE_SECTIONS) {
      expect(resourcesBySection(s.id).flatMap(g => g.links).length, s.id).toBeGreaterThan(0);
    }
  });

  it('keeps every title and note plain: present, short, no em dashes', () => {
    for (const r of RESOURCES) {
      expect(r.title.trim().length, r.url).toBeGreaterThan(2);
      expect(r.note.trim().length, r.url).toBeGreaterThan(5);
      expect(r.note.length, r.url).toBeLessThanOrEqual(160);
      expect(`${r.title}${r.note}`.includes('—'), r.url).toBe(false);
    }
  });

  it('compiles every expected-title pattern', () => {
    for (const r of RESOURCES) {
      if (r.expect) expect(() => new RegExp(r.expect as string, 'i'), r.url).not.toThrow();
    }
  });

  it('has valid verification dates, none in the future', () => {
    for (const r of RESOURCES) {
      expect(r.verifiedAt, r.url).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(ageInDays(r.verifiedAt), r.url).toBeGreaterThanOrEqual(0);
    }
  });

  it('counts the age of a verification in whole days', () => {
    const now = Date.parse('2026-10-23T12:00:00Z');
    expect(ageInDays('2026-10-23', now)).toBe(0);
    expect(ageInDays('2026-07-25', now)).toBe(90);
    expect(MAX_AGE_DAYS).toBe(90);
  });

  it('classifies a link by where it points', () => {
    const base = { section: 'build' as const, group: 'Reference', title: 't', note: 'n', verifiedAt: '2026-10-23' };
    expect(linkKind({ ...base, url: 'https://docs.example.org/x' })).toBe('Docs');
    expect(linkKind({ ...base, url: 'https://github.com/org/repo' })).toBe('Code');
    expect(linkKind({ ...base, url: 'https://youtu.be/abc' })).toBe('Video');
    expect(linkKind({ ...base, url: 'https://forum.example.org/' })).toBe('Forum');
    expect(linkKind({ ...base, url: 'https://discord.com/invite/x' })).toBe('Chat');
    expect(linkKind({ ...base, url: '/glossary' })).toBe('This site');
    expect(linkKind({ ...base, url: 'https://example.org/' })).toBe('Link');
  });

  it('finds links by title, note, host and group, every word has to match', () => {
    const first = RESOURCES[0];
    expect(linkMatches(first, '')).toBe(true);
    expect(linkMatches(first, linkHost(first.url))).toBe(true);
    expect(linkMatches(first, first.title.split(' ')[0].toLowerCase())).toBe(true);
    expect(linkMatches(first, 'zzzzqq')).toBe(false);
    expect(linkMatches(first, `${first.title.split(' ')[0].toLowerCase()} zzzzqq`)).toBe(false);
  });

  it('offers only search suggestions that find something', () => {
    expect(SEARCH_SUGGESTIONS.length).toBeGreaterThanOrEqual(3);
    for (const q of SEARCH_SUGGESTIONS) expect(RESOURCES.filter(r => linkMatches(r, q)).length, q).toBeGreaterThan(0);
  });

  it('gives every section a short tagline', () => {
    for (const s of RESOURCE_SECTIONS) {
      expect(s.tagline.length, s.id).toBeGreaterThan(0);
      expect(s.tagline.length, s.id).toBeLessThanOrEqual(32);
    }
  });

  it('finds a stated phrase in markdown and in html, ignoring case, emphasis and tags', () => {
    expect(evidenceFound('The **public coordination layer** operated by validators', 'public coordination layer operated')).toBe(true);
    expect(evidenceFound('<p>Fair <b>governance</b>\n and oversight</p>', 'governance and oversight')).toBe(true);
    expect(evidenceFound('Four environments', 'four ENVIRONMENTS')).toBe(true);
    expect(evidenceFound('Three environments', 'four environments')).toBe(false);
  });

  it('keeps every learn fact short, sourced over https and checkable', () => {
    expect(new Set(LEARN_FACTS.map(f => f.id)).size).toBe(LEARN_FACTS.length);
    for (const f of LEARN_FACTS) {
      expect(f.text.length, f.id).toBeLessThanOrEqual(220);
      expect(f.text, f.id).not.toMatch(/—/);
      expect(new URL(f.url).protocol, f.id).toBe('https:');
      if (f.evidenceUrl) expect(new URL(f.evidenceUrl).protocol, f.id).toBe('https:');
      expect(() => new RegExp(f.evidence, 'i'), f.id).not.toThrow();
      expect(f.evidence.length, f.id).toBeGreaterThanOrEqual(12);
      expect(f.verifiedAt, f.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(ageInDays(f.verifiedAt), f.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('points every page link at a page that exists in the app', () => {
    expect(PAGE_LINKS.length).toBeGreaterThan(0);
    for (const l of PAGE_LINKS) {
      expect(l.href.startsWith('/'), l.href).toBe(true);
      const base = path.join(__dirname, '..', '..', 'app', l.href.replace(/^\//, ''));
      const exists = ['page.tsx', 'page.ts', 'route.ts', 'route.tsx'].some(f => fs.existsSync(path.join(base, f)));
      expect(exists, `no page at ${l.href}`).toBe(true);
    }
  });

  it('has no link on the page or in the browser that the weekly check does not know', () => {
    const known = new Set([...RESOURCES.filter(r => r.url.startsWith('/')).map(r => r.url), ...PAGE_LINKS.map(l => l.href)]);
    for (const file of ['app/resources/page.tsx', 'components/resources-browser.tsx']) {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
      expect(src, `${file} has a literal external link`).not.toMatch(/href=(?:"|\{'|\{`)https?:/);
      for (const m of src.matchAll(/href=(?:"|\{'|\{`)(\/[^"'`}]*)/g)) expect(known.has(m[1]), `${file} links to ${m[1]} outside the checked lists`).toBe(true);
    }
  });
});
