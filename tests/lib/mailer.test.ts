// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isMailerConfigured } from '@/lib/mailer';

describe('isMailerConfigured', () => {
  let origUser: string | undefined;
  let origPass: string | undefined;

  beforeEach(() => {
    origUser = process.env.SMTP_USER;
    origPass = process.env.SMTP_PASS;
  });

  afterEach(() => {
    if (origUser === undefined) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = origUser;
    if (origPass === undefined) delete process.env.SMTP_PASS;
    else process.env.SMTP_PASS = origPass;
  });

  it('returns false when SMTP_USER missing', () => {
    delete process.env.SMTP_USER;
    process.env.SMTP_PASS = 'something';
    expect(isMailerConfigured()).toBe(false);
  });

  it('returns false when SMTP_PASS missing', () => {
    process.env.SMTP_USER = 'user@example.com';
    delete process.env.SMTP_PASS;
    expect(isMailerConfigured()).toBe(false);
  });

  it('returns true when both set', () => {
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'pw';
    expect(isMailerConfigured()).toBe(true);
  });
});
