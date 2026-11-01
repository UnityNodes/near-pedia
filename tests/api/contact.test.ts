// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.DB_PATH = ':memory:';

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  isMailerConfigured: vi.fn(),
}));

vi.mock('@/lib/mailer', () => ({
  sendMail: mocks.sendMail,
  isMailerConfigured: mocks.isMailerConfigured,
}));

const sendMailMock = mocks.sendMail;
const isMailerConfiguredMock = mocks.isMailerConfigured;

import { POST } from '@/app/api/contact/route';

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/contact', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'x-real-ip': '127.0.0.1',
      ...headers,
    },
  });
}

const validPayload = {
  name: 'Alice',
  email: 'alice@example.com',
  subject: 'Hello',
  message: 'This is a test message with enough characters.',
};

describe('POST /api/contact', () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    isMailerConfiguredMock.mockReset();
    sendMailMock.mockResolvedValue({ ok: true, messageId: 'test-1' });
    isMailerConfiguredMock.mockReturnValue(true);
  });

  it('returns 400 for invalid JSON', async () => {
    const req = new Request('http://localhost/api/contact', {
      method: 'POST',
      body: '{not json',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': '10.0.0.1' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing name', async () => {
    const res = await POST(makeReq({ ...validPayload, name: '' }, { 'x-real-ip': '10.0.0.2' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid email', async () => {
    const res = await POST(makeReq({ ...validPayload, email: 'not-an-email' }, { 'x-real-ip': '10.0.0.3' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for too-short message', async () => {
    const res = await POST(makeReq({ ...validPayload, message: 'hi' }, { 'x-real-ip': '10.0.0.4' }));
    expect(res.status).toBe(400);
  });

  it('silently accepts honeypot-filled submission without sending mail', async () => {
    const res = await POST(makeReq({ ...validPayload, website: 'http://spam.test' }, { 'x-real-ip': '10.0.0.5' }));
    expect(res.status).toBe(200);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('returns 503 when mailer not configured', async () => {
    isMailerConfiguredMock.mockReturnValue(false);
    const res = await POST(makeReq(validPayload, { 'x-real-ip': '10.0.0.6' }));
    expect(res.status).toBe(503);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('sends mail on valid payload and returns 200', async () => {
    const res = await POST(makeReq(validPayload, { 'x-real-ip': '10.0.0.7' }));
    expect(res.status).toBe(200);
    expect(sendMailMock).toHaveBeenCalledOnce();
    const call = sendMailMock.mock.calls[0][0];
    expect(call.subject).toContain('Hello');
    expect(call.text).toContain('Alice');
    expect(call.text).toContain('alice@example.com');
    expect(call.replyTo).toContain('alice@example.com');
  });

  it('returns 502 when mailer.sendMail fails', async () => {
    sendMailMock.mockResolvedValue({ ok: false, error: 'SMTP timeout' });
    const res = await POST(makeReq(validPayload, { 'x-real-ip': '10.0.0.8' }));
    expect(res.status).toBe(502);
  });

  it('rate-limits after cooldown', async () => {
    const ip = '10.0.1.1';
    const first = await POST(makeReq(validPayload, { 'x-real-ip': ip }));
    expect(first.status).toBe(200);
    // Immediate second submission triggers cooldown (10s) for same IP.
    const second = await POST(makeReq(validPayload, { 'x-real-ip': ip }));
    expect(second.status).toBe(429);
    expect(second.headers.get('Retry-After')).toBeTruthy();
  });
});
