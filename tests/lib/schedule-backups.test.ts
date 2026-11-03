import { describe, expect, it } from 'vitest';
import { toleranceSecondsBySource } from '@/lib/schedule';

describe('backups on the schedule', () => {
  it('gives the backup, its freshness check and the restore drill a deadline, so a run that stops is late, not invisible', () => {
    const t = toleranceSecondsBySource();
    expect(t.get('backup-db')).toBe(36 * 3600);
    expect(t.get('backup-offbox')).toBe(36 * 3600);
    expect(t.get('backup-freshness')).toBe(3 * 3600);
    expect(t.get('restore-drill-offbox')).toBe(200 * 3600);
  });
});
