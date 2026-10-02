import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ItemState } from '../../packages/contracts/index.ts';
import { foldItem, replay } from '../../packages/harness/index.ts';
import { itemEventSequence } from './item-events.ts';

describe('KN-4 replay is deterministic over random valid sequences', () => {
  it('gives the same state twice and equals the incremental fold', () => {
    fc.assert(
      fc.property(itemEventSequence(), (events) => {
        const once = replay(events);
        expect(replay(structuredClone(events))).toEqual(once);
        const incremental = events.reduce<ItemState | null>(foldItem, null);
        expect(incremental).toEqual(once);
      }),
      { numRuns: 200 },
    );
  });
});
