// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resultLink } from '@/lib/result-link';
import { SITE } from '@/lib/site.config';

const host = new URL(SITE.url).host;

describe('resultLink', () => {
  it('keeps a result on this site inside the site, whatever host serves the page', () => {
    expect(resultLink(`${SITE.url}/docs/intro#start`, 'localhost:3000')).toEqual({ internal: true, path: '/docs/intro#start' });
    expect(resultLink('/proposals/7?tab=milestones', host)).toEqual({ internal: true, path: '/proposals/7?tab=milestones' });
    expect(resultLink('http://localhost:3000/docs/x', 'localhost:3000')).toEqual({ internal: true, path: '/docs/x' });
  });

  it('opens a result hosted elsewhere at its own address instead of as a path on this site', () => {
    expect(resultLink('https://github.com/your-org/your-repo/issues/42', host))
      .toEqual({ internal: false, href: 'https://github.com/your-org/your-repo/issues/42' });
  });

  it('never hands a non-web scheme to the browser', () => {
    expect(resultLink('javascript:alert(1)', host)).toEqual({ internal: true, path: '/' });
  });
});
