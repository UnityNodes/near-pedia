import fs from 'node:fs';
import path from 'node:path';
import { LEARN_FACTS, MAX_AGE_DAYS, PAGE_LINKS, RESOURCES, ageInDays, evidenceFound, type LearnFact, type ResourceLink } from '../lib/resources';
import { repoPath } from '../lib/repo-root';
import { SITE } from '../lib/site.config';
import { logRun } from '../lib/sync-log';

const UA = `${SITE.name}-LinkCheck/1.0 (+${SITE.url})`;
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 6;
const MAX_BODY = 200_000;

interface Outcome {
  label: string;
  where: string;
  problem: string | null;
}

interface Page {
  status: number;
  finalUrl: string;
  title: string;
  body: string;
}

function normalize(url: string): string {
  const u = new URL(url);
  return `${u.host.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
}

function titleOf(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const og = html.match(/property="og:title"\s+content="([^"]*)"/i);
  return (m?.[1] ?? og?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

async function once(url: string): Promise<Page> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.text()).slice(0, MAX_BODY);
  return { status: res.status, finalUrl: res.url, title: titleOf(body), body };
}

async function read(url: string): Promise<Page | { error: string }> {
  let last: Page | { error: string } = { error: 'no attempt' };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      last = await once(url);
      if (last.status < 400) return last;
    } catch (err) {
      last = { error: String((err as Error).message ?? err).slice(0, 80) };
    }
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 3000));
  }
  return last;
}

async function youtubeAvailable(url: string): Promise<boolean> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function internalRouteExists(url: string): boolean {
  const base = path.join(repoPath(), 'app', url.replace(/^\//, ''));
  return ['page.tsx', 'page.ts', 'route.ts', 'route.tsx'].some(f => fs.existsSync(path.join(base, f)));
}

function staleness(verifiedAt: string): string | null {
  const age = ageInDays(verifiedAt);
  return age > MAX_AGE_DAYS ? `not re-verified for ${age} days` : null;
}

async function checkLink(link: ResourceLink): Promise<Outcome> {
  const out = (problem: string | null): Outcome => ({ label: `${link.section}/${link.group}: ${link.title}`, where: link.url, problem });
  const stale = staleness(link.verifiedAt);
  if (link.url.startsWith('/')) return out(internalRouteExists(link.url) ? stale : `no page at ${link.url}`);
  if (link.unverifiable) return out(stale);
  const host = new URL(link.url).host.replace(/^www\./, '');
  if (host === 'youtu.be' || host === 'youtube.com') {
    const ok = await youtubeAvailable(link.url);
    return out(ok ? stale : 'video is not available');
  }
  const got = await read(link.url);
  if ('error' in got) return out(`unreachable (${got.error})`);
  if (got.status >= 400) return out(`HTTP ${got.status}`);
  if (normalize(got.finalUrl) !== normalize(link.url)) return out(`moved to ${got.finalUrl}`);
  if (link.expect && !new RegExp(link.expect, 'i').test(got.title)) {
    return out(`page title "${got.title}" no longer matches /${link.expect}/`);
  }
  return out(stale);
}

async function checkFact(fact: LearnFact): Promise<Outcome> {
  const out = (problem: string | null): Outcome => ({ label: `learn fact: ${fact.id}`, where: fact.evidenceUrl ?? fact.url, problem });
  const evidenceUrl = fact.evidenceUrl ?? fact.url;
  const source = await read(evidenceUrl);
  if ('error' in source) return out(`source unreachable (${source.error})`);
  if (source.status >= 400) return out(`source returned HTTP ${source.status}`);
  if (normalize(source.finalUrl) !== normalize(evidenceUrl)) return out(`source moved to ${source.finalUrl}`);
  if (!evidenceFound(source.body, fact.evidence)) return out(`the source no longer says /${fact.evidence}/`);
  if (fact.evidenceUrl) {
    const shown = await read(fact.url);
    if ('error' in shown) return out(`linked page unreachable (${shown.error})`);
    if (shown.status >= 400) return out(`linked page returned HTTP ${shown.status}`);
  }
  return out(staleness(fact.verifiedAt));
}

function checkPageLink(href: string, label: string): Outcome {
  return { label: `page link: ${label}`, where: href, problem: internalRouteExists(href) ? null : `no page at ${href}` };
}

async function main(): Promise<void> {
  const tasks: (() => Promise<Outcome>)[] = [
    ...RESOURCES.map(link => () => checkLink(link)),
    ...LEARN_FACTS.map(fact => () => checkFact(fact)),
    ...PAGE_LINKS.map(l => async () => checkPageLink(l.href, l.label)),
  ];
  const outcomes: Outcome[] = [];
  let next = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      outcomes.push(await task());
    }
  });
  await Promise.all(workers);

  const problems = outcomes.filter(o => o.problem !== null);
  const skipped = RESOURCES.filter(l => l.unverifiable).length;
  console.log(`[check-resources] ${RESOURCES.length} links, ${LEARN_FACTS.length} facts, ${PAGE_LINKS.length} page links, ${skipped} not machine-checkable, ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p.label}: ${p.problem}  ${p.where}`);

  logRun('check-resources', {
    status: problems.length ? 'partial' : 'success',
    items: tasks.length,
    error: problems.length
      ? problems.map(p => `${p.label}: ${p.problem}`).join(' ; ').slice(0, 1000)
      : undefined,
  });
  if (problems.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  logRun('check-resources', { status: 'error', items: 0, error: String(err).slice(0, 1000) });
  process.exitCode = 1;
});
