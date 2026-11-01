import { describe, expect, it } from 'vitest';
import { isTransportProbe, isVersionNegotiation } from '../../lib/mcp-negotiation';

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
