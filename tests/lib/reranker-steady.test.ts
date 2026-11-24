// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { probeRerankerSteady, type RerankProbe } from '@/lib/reranker';

function scripted(results: RerankProbe[]): { probe: () => Promise<RerankProbe>; calls: () => number } {
  let i = 0;
  return { probe: async () => results[i++], calls: () => i };
}

const ok: RerankProbe = { provider: 'nearai', ok: true, ms: 500 };
const slow: RerankProbe = { provider: 'nearai', ok: false, ms: 3004, error: 'over 3000ms deadline' };

describe('probeRerankerSteady', () => {
  it('passes after two good probes without a third call', async () => {
    const s = scripted([ok, ok, slow]);
    const r = await probeRerankerSteady(s.probe, 3);
    expect(r.ok).toBe(true);
    expect(s.calls()).toBe(2);
  });

  it('passes when one of three probes runs over the deadline', async () => {
    const s = scripted([slow, ok, ok]);
    const r = await probeRerankerSteady(s.probe, 3);
    expect(r.ok).toBe(true);
    expect(r.runs).toHaveLength(3);
  });

  it('fails when most probes run over the deadline', async () => {
    const s = scripted([slow, ok, slow]);
    const r = await probeRerankerSteady(s.probe, 3);
    expect(r.ok).toBe(false);
    expect(r.runs.filter(x => !x.ok)).toHaveLength(2);
  });

  it('stops after two failures in a row', async () => {
    const s = scripted([slow, slow, ok]);
    const r = await probeRerankerSteady(s.probe, 3);
    expect(r.ok).toBe(false);
    expect(s.calls()).toBe(2);
  });

  it('fails at once when no reranker is configured', async () => {
    const s = scripted([{ provider: null, ok: false, ms: 0, error: 'no reranker configured' }, ok, ok]);
    const r = await probeRerankerSteady(s.probe, 3);
    expect(r.ok).toBe(false);
    expect(s.calls()).toBe(1);
  });
});
