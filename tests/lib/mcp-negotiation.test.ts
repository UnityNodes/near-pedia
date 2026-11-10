import { describe, expect, it } from 'vitest';
import { isTransportProbe, isVersionNegotiation, refusalDetail } from '../../lib/mcp-negotiation';

const unsupported = {
  jsonrpc: '2.0',
  error: { code: -32022, message: 'Unsupported protocol version: 2025-06-18', data: { supported: ['2026-07-28'], requested: '2025-06-18' } },
  id: 7,
};

describe('isVersionNegotiation', () => {
  it('treats a 400 carrying the unsupported-protocol-version error as the handshake, not a mistake', () => {
    expect(isVersionNegotiation(400, [unsupported])).toBe(true);
  });

  it('does not excuse the same code on any other status', () => {
    expect(isVersionNegotiation(200, [unsupported])).toBe(false);
    expect(isVersionNegotiation(500, [unsupported])).toBe(false);
  });

  it('still counts every other 400 as a refusal', () => {
    expect(isVersionNegotiation(400, [{ jsonrpc: '2.0', error: { code: -32600, message: 'Bad Request' }, id: null }])).toBe(false);
    expect(isVersionNegotiation(400, [])).toBe(false);
  });

  it('survives bodies that are not JSON-RPC objects', () => {
    expect(isVersionNegotiation(400, [null, 'text', 42, { error: null }, { error: 'x' }])).toBe(false);
  });
});

describe('isTransportProbe', () => {
  it('does not count a browser or scanner opening /mcp with GET as a caller mistake', () => {
    expect(isTransportProbe('GET', 406)).toBe(true);
    expect(isTransportProbe('GET', 405)).toBe(true);
    expect(isTransportProbe('HEAD', 405)).toBe(true);
  });

  it('still counts a failed POST, and a GET that failed for another reason', () => {
    expect(isTransportProbe('POST', 400)).toBe(false);
    expect(isTransportProbe('POST', 406)).toBe(false);
    expect(isTransportProbe('GET', 500)).toBe(false);
    expect(isTransportProbe('DELETE', 405)).toBe(false);
  });
});

describe('refusalDetail', () => {
  it('names the error the caller got, so the daily report shows why', () => {
    const frame = { jsonrpc: '2.0', id: 1, error: { code: -32020, message: 'Bad Request: the body names method tools/list but the required Mcp-Method header is absent' } };
    expect(refusalDetail(400, 'POST', '2026-07-28', [frame]))
      .toBe('HTTP 400 on POST /mcp (protocol 2026-07-28): -32020 Bad Request: the body names method tools/list but the required Mcp-Method header is absent');
  });

  it('keeps the bare status line when the body has no error text', () => {
    expect(refusalDetail(400, 'POST', undefined, [])).toBe('HTTP 400 on POST /mcp (protocol none)');
    expect(refusalDetail(404, 'POST', '2026-07-28', [null, 'x', { error: { code: -32601 } }, { error: { message: '  ' } }]))
      .toBe('HTTP 404 on POST /mcp (protocol 2026-07-28)');
  });

  it('flattens and caps a long or multi-line message', () => {
    const detail = refusalDetail(400, 'POST', 'none', [{ error: { message: `a\n\nb ${'x'.repeat(500)}` } }]);
    expect(detail.startsWith('HTTP 400 on POST /mcp (protocol none): a b x')).toBe(true);
    expect(detail.length).toBeLessThan(260);
  });
});
