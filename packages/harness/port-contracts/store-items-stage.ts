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

export function describeLowestOpen(subject: ItemsSubject): void {
  it('WB-2 reads the lowest priority among a stage’s open items, and null for a stage with none', async () => {
    const { store } = subject();
    await store.transaction(async (tx) => {
      await seedHarness(tx, base + 0x100, 'gateway-stage-lowest');
      const rows = [
        itemOf(base + 0x100, 1, { priority: 10 }),
        itemOf(base + 0x100, 2, { priority: -5, gateStatus: 'done' }),
        itemOf(base + 0x100, 3, { priority: 7 }),
        itemOf(base + 0x100, 4, { priority: 3, stageKey: 'review' }),
      ];
      for (const row of rows) await tx.harnessItems.write.insert(row, at);
    });
    const lowest = await store.transaction(async (tx) => [
      await tx.harnessItems.read.lowestOpenPriority(uid(base + 0x100), 'build'),
      await tx.harnessItems.read.lowestOpenPriority(uid(base + 0x100), 'ship'),
    ]);
    expect(lowest).toEqual([7, null]);
  });
}
