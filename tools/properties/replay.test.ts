import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ItemState } from '../../packages/contracts/index.ts';
import { foldItem, replay } from '../../packages/harness/index.ts';
import { itemEventSequence, type ItemSequence } from './item-events.ts';

function foldFrom(state: ItemState | null, events: ItemSequence['events']): ItemState | null {
  return events.reduce<ItemState | null>(foldItem, state);
}

describe('KN-4 replay is deterministic and agrees with a model over random valid sequences', () => {
  it('gives the same state twice without touching its input', () => {
    fc.assert(
      fc.property(itemEventSequence(), ({ events }) => {
        const before = structuredClone(events);
        const once = replay(events);
        expect(events).toEqual(before);
        expect(replay(structuredClone(events))).toEqual(once);
      }),
      { numRuns: 200 },
    );
  });

  it('equals the model state, however the log is split between two folds', () => {
    fc.assert(
      fc.property(itemEventSequence(), fc.nat({ max: 60 }), ({ events, expected }, cut) => {
        const split = Math.min(cut, events.length);
        const prefix = foldFrom(null, events.slice(0, split));
        const resumed = foldFrom(prefix, events.slice(split));
        expect(resumed).toEqual(replay(events));
        expect(resumed).toMatchObject(expected);
      }),
      { numRuns: 200 },
    );
  });
});
