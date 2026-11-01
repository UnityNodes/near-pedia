import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatRelativeTime } from '@/lib/utils';

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows minutes for times under 1 hour', () => {
    expect(formatRelativeTime('2026-05-02T11:30:00.000Z')).toBe('30m ago');
  });

  it('shows hours for times under 24 hours', () => {
    expect(formatRelativeTime('2026-05-02T08:00:00.000Z')).toBe('4h ago');
  });

  it('shows days for times under 30 days', () => {
    expect(formatRelativeTime('2026-04-29T12:00:00.000Z')).toBe('3d ago');
  });

  it('shows month/year for older dates', () => {
    expect(formatRelativeTime('2025-01-15T12:00:00.000Z')).toBe('Jan 2025');
  });

  it('shows 0m ago for very recent dates', () => {
    expect(formatRelativeTime('2026-05-02T11:59:30.000Z')).toBe('0m ago');
  });
});
