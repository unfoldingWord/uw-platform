import { describe, expect, it } from 'vitest';
import type { Store } from '../ports.ts';
import { at, itemOf, seedHarness } from './store-gateway-fixtures.ts';

type EpicSubject = () => { readonly store: Store };

const place = {
  issue: { repo: 'unfoldingWord/uw-platform', number: 40, githubId: 9100000340 },
  title: 'Epic intake',
  position: 2,
};

export function describeStoreItemsEpic(adapter: string, subject: EpicSubject): void {
  describe(`store keeps an item's epic place and blockers on ${adapter}`, () => {
    it('DX-3 EI-3 inserts, reads, lists and projects the epic place and the blockers', async () => {
      const read = await subject().store.transaction(async (tx) => {
        await seedHarness(tx, 0x7700, 'gateway-epic');
        const blocker = itemOf(0x7700, 1, {});
        const waiting = itemOf(0x7700, 2, { epic: place, blockedBy: [blocker.itemId] });
        await tx.harnessItems.write.insert(blocker, at);
        await tx.harnessItems.write.insert(waiting, at);
        const inserted = await tx.harnessItems.read.byId(waiting.itemId);
        const listed = await tx.harnessItems.read.byIds([waiting.itemId]);
        await tx.harnessItems.write.project({ ...waiting, blockedBy: [] });
        return {
          blockerId: blocker.itemId,
          inserted,
          listed,
          projected: await tx.harnessItems.read.byId(waiting.itemId),
          plain: await tx.harnessItems.read.byId(blocker.itemId),
        };
      });
      expect(read.inserted).toMatchObject({ epic: place, blockedBy: [read.blockerId] });
      expect(read.listed[0]).toMatchObject({ epic: place, blockedBy: [read.blockerId] });
      expect(read.projected).toMatchObject({ epic: place, blockedBy: [] });
      expect(read.plain).toMatchObject({ epic: null, blockedBy: [] });
    });
  });
}
