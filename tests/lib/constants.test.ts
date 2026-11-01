import { describe, it, expect } from 'vitest';
import { radarLiveSql } from '@/lib/constants';

describe('lib/constants', () => {
  it('radarLiveSql treats a NULL expiry as live, never as expired', () => {
    expect(radarLiveSql()).toMatch(/expires_at IS NULL OR expires_at >/);
  });

  it('radarLiveSql prefixes columns with the given alias', () => {
    expect(radarLiveSql('t')).toContain('t.expires_at');
    expect(radarLiveSql('t')).not.toMatch(/(?<!t\.)expires_at/);
  });
});
