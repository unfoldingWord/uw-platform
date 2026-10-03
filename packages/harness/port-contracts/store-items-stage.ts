import { expect, it } from 'vitest';
import type { ItemState } from '@uw/contracts';
import type { Store } from '../ports.ts';
import { at, itemOf, seedHarness, uid } from './store-gateway-fixtures.ts';

type ItemsSubject = () => { readonly store: Store };

const base = 0x2200;

function seeded(store: Store) {
  return store.transaction(async (tx) => {
    await seedHarness(tx, base, 'gateway-stage-page');
    const rows = [
      itemOf(base, 1, { priority: 10 }),
      itemOf(base, 2, { priority: 30 }),
      itemOf(base, 3, { priority: 10 }),
      itemOf(base, 4, { priority: 20 }),
      itemOf(base, 5, { priority: 40, gateStatus: 'done' }),
      itemOf(base, 6, { priority: 50, stageKey: 'review' }),
    ];
    for (const row of rows) await tx.harnessItems.write.insert(row, at);
  });
}

function idsOf(page: readonly ItemState[]): string[] {
  return page.map((item) => item.itemId);
}

export function describeStageItems(subject: ItemsSubject): void {
  it('WB-2 reads one page of a stage’s open items by priority then id, and the next page after a cursor', async () => {
    const { store } = subject();
    await seeded(store);
    const ids = await store.transaction(async (tx) => {
      const read = (after: { priority: number; itemId: string } | null) =>
        tx.harnessItems.read.openInStage(uid(base), 'build', { after, limit: 2 });
      const first = await read(null);
      const last = first.at(-1);
      const second = last === undefined ? [] : await read(last);
      const tail = await read({ priority: 10, itemId: uid(base + 11) });
      return [first, second, tail].map(idsOf);
    });
    expect(ids).toEqual([
      [uid(base + 12), uid(base + 14)],
      [uid(base + 11), uid(base + 13)],
      [uid(base + 13)],
    ]);
  });
}
