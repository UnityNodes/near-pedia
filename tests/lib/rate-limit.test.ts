import { describe, it, expect } from 'vitest';
import { getIdentifiers } from '@/lib/rate-limit';

describe('getIdentifiers', () => {
  it('reads x-forwarded-for first IP', () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    expect(getIdentifiers(req).ip).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip', () => {
    const req = new Request('http://x', { headers: { 'x-real-ip': '9.9.9.9' } });
    expect(getIdentifiers(req).ip).toBe('9.9.9.9');
  });

  it('falls back to unknown', () => {
    const req = new Request('http://x');
    expect(getIdentifiers(req).ip).toBe('unknown');
  });
});
