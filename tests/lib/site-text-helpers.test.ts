import { describe, expect, it } from 'vitest';
import { splitEffective } from '../../lib/effective-text';
import { countSyncedWithin, DAY_MS } from '../../lib/synced-within';
import { signalLabel } from '../../app/deprecations/signal-labels';

describe('splitEffective', () => {
  it('keeps the part before the semicolon as the chip and turns the rest into a sentence', () => {
    expect(splitEffective('protocol version 87 (nearcore 2.14.0); applies on a network once its validators vote the upgrade in')).toEqual({
      chip: 'protocol version 87 (nearcore 2.14.0)',
      note: 'Applies on a network once its validators vote the upgrade in.',
    });
  });

  it('returns the whole text as the chip when there is no clause', () => {
    expect(splitEffective('nearcore 2.14.0')).toEqual({ chip: 'nearcore 2.14.0', note: null });
  });

  it('keeps a closing full stop and drops an empty clause', () => {
    expect(splitEffective('near-sdk 4.0.0; see the notes.')?.note).toBe('See the notes.');
    expect(splitEffective('near-sdk 4.0.0;')).toEqual({ chip: 'near-sdk 4.0.0', note: null });
  });

  it('returns null for no value', () => {
    expect(splitEffective(null)).toBeNull();
    expect(splitEffective('')).toBeNull();
  });
});

describe('countSyncedWithin', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');

  it('counts sources synced inside the window and skips missing or unparseable stamps', () => {
    const sources = [
      { last_synced: '2026-11-08T11:00:00Z' },
      { last_synced: '2026-11-07T12:00:01Z' },
      { last_synced: '2026-11-07T11:59:59Z' },
      { last_synced: null },
      { last_synced: 'not a date' },
    ];
    expect(countSyncedWithin(sources, DAY_MS, now)).toBe(2);
  });
});

describe('signalLabel', () => {
  it('names every signal the curated entries cite', () => {
    for (const s of ['docs_statement', 'probe', 'registry_activity', 'ecosystem_list', 'dormant_with_successor']) {
      expect(signalLabel(s)).not.toBe(s);
    }
  });

  it('falls back to the raw key for an unknown signal', () => {
    expect(signalLabel('something_new')).toBe('something_new');
  });
});
