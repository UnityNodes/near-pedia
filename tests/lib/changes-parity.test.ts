import { describe, it, expect } from 'vitest';
import { kindMismatches } from '../../lib/changes-parity';

const rest = (items: { kind: string; when: string }[], total = items.length) => ({ items, total });

describe('kindMismatches', () => {
  it('ignores a kind that only sits past the end of a capped MCP list', () => {
    const restItems = [
      { kind: 'change_event', when: '2026-11-08T10:00:00.000Z' },
      { kind: 'change_event', when: '2026-11-05T10:00:00.000Z' },
      { kind: 'new_radar_item', when: '2026-11-02T16:48:08.461Z' },
    ];
    const mcpItems = [
      { kind: 'change_event', when: '2026-11-08 10:00' },
      { kind: 'change_event', when: '2026-11-05 10:00' },
    ];
    expect(kindMismatches(rest(restItems), { items: mcpItems, total: 3 })).toEqual({ onlyRest: [], onlyMcp: [] });
  });

  it('still flags a kind missing inside the span both roads cover', () => {
    const restItems = [
      { kind: 'change_event', when: '2026-11-08T10:00:00.000Z' },
      { kind: 'new_radar_item', when: '2026-11-07T10:00:00.000Z' },
      { kind: 'change_event', when: '2026-11-05T10:00:00.000Z' },
    ];
    const mcpItems = [
      { kind: 'change_event', when: '2026-11-08 10:00' },
      { kind: 'change_event', when: '2026-11-05 10:00' },
    ];
    expect(kindMismatches(rest(restItems), { items: mcpItems, total: 3 }).onlyRest).toEqual(['new_radar_item']);
  });

  it('compares the full lists when neither road is capped', () => {
    const restItems = [{ kind: 'new_release', when: '2026-11-01T00:00:00.000Z' }];
    expect(kindMismatches(rest(restItems), { items: [], total: 0 }).onlyRest).toEqual(['new_release']);
  });
});
