import { describe, expect, it } from 'vitest';
import { askFailure, providerNote, providerStatus } from '@/lib/ask-failure';
import { BusyError, UnverifiedAnswerError } from '@/lib/near-ai';

const withStatus = (message: string, status: number) => Object.assign(new Error(message), { status });

describe('providerStatus', () => {
  it('reads the HTTP status from the error, its cause chain or an SDK failure', () => {
    expect(providerStatus(withStatus('Unauthorized', 401))).toBe(401);
    expect(providerStatus(new Error('wrapped', { cause: withStatus('Payment Required', 402) }))).toBe(402);
    expect(providerStatus(Object.assign(new Error('api'), { failure: { code: 'api.http_status', details: { resource: 'chat', status: 503 } } }))).toBe(503);
    expect(providerStatus(new Error('socket hang up'))).toBeNull();
    expect(providerStatus('not an error')).toBeNull();
  });
});

describe('providerNote', () => {
  it('names the key or credits for 401 and 402', () => {
    expect(providerNote(401)).toMatch(/HTTP 401.*key or credits/);
    expect(providerNote(402)).toMatch(/HTTP 402.*key or credits/);
    expect(providerNote(500)).toBe('NEAR AI returned HTTP 500');
    expect(providerNote(null)).toBeNull();
  });
});

describe('askFailure', () => {
  it('does not record a busy refusal', () => {
    const f = askFailure(new BusyError('4 answers are already being written'));
    expect(f.status).toBe(503);
    expect(f.record).toBeNull();
    expect(f.body.error).toMatch(/already being written/);
  });

  it('records an unverified answer as degraded', () => {
    const f = askFailure(new UnverifiedAnswerError('the response carries a gateway signature'));
    expect(f.status).toBe(502);
    expect(f.record).toEqual({ kind: 'degraded', detail: 'the response carries a gateway signature' });
  });

  it('records a provider refusal as failed and passes its status to the caller', () => {
    const f = askFailure(withStatus('401 Unauthorized', 401));
    expect(f.status).toBe(502);
    expect(f.record?.kind).toBe('failed');
    expect(f.record?.detail).toMatch(/^NEAR AI refused the request \(HTTP 401\): key or credits; 401 Unauthorized/);
    expect(f.body.detail).toBe(f.record?.detail);
  });

  it('records an error without a status as it came and caps the detail', () => {
    const f = askFailure(new Error(`fetch failed ${'x'.repeat(400)}`));
    expect(f.record?.kind).toBe('failed');
    expect(f.record?.detail.length).toBe(300);
    expect(f.record?.detail.startsWith('fetch failed')).toBe(true);
  });
});
