import { describe, expect, it } from 'vitest';
import type { Store } from '../ports.ts';
import { at, harnessOf, itemOf, seedHarness, uid } from './store-gateway-fixtures.ts';

type ObservabilitySubject = () => { readonly store: Store };

export function describeStoreObservability(adapter: string, subject: ObservabilitySubject): void {
  describe(`store columns for observability on ${adapter}`, () => {
    it('DX-3 stores the bot authors and when an item was taken', async () => {
      const harness = { ...harnessOf(0x7a00, 'gateway-bots'), botAuthors: ['renovate[bot]'] };
      const held = itemOf(0x7b00, 1, { heldSince: '2026-10-01T08:00:00.000Z' });
      const read = await subject().store.transaction(async (tx) => {
        await tx.harnesses.write.insert(harness, at);
        await seedHarness(tx, 0x7b00, 'gateway-observed');
        await tx.harnessItems.write.insert(held, at);
        const inserted = await tx.harnessItems.read.byId(held.itemId);
        await tx.harnessItems.write.project({ ...held, heldSince: '2026-10-01T09:30:00.000Z' });
        return {
          harness: await tx.harnesses.read.byId(harness.id),
          inserted,
          projected: await tx.harnessItems.read.byId(held.itemId),
          plain: await tx.harnessItems.read.byId(uid(0x9999)),
        };
      });
      expect(read.harness?.botAuthors).toEqual(['renovate[bot]']);
      expect(read.inserted?.heldSince).toBe('2026-10-01T08:00:00.000Z');
      expect(read.projected?.heldSince).toBe('2026-10-01T09:30:00.000Z');
      expect(read.plain).toBeNull();
    });

    it('DX-3 changes a template only from the one it names', async () => {
      const harness = { ...harnessOf(0x7c00, 'gateway-template'), template: 'check-only' };
      const read = await subject().store.transaction(async (tx) => {
        await tx.harnesses.write.insert(harness, at);
        const wrong = await tx.harnesses.write.setTemplate(harness.id, 'bml', 'software');
        const changed = await tx.harnesses.write.setTemplate(harness.id, 'check-only', 'software');
        const again = await tx.harnesses.write.setTemplate(harness.id, 'check-only', 'software');
        const missing = await tx.harnesses.write.setTemplate(uid(0x7cff), 'check-only', 'software');
        return { wrong, changed, again, missing, after: await tx.harnesses.read.byId(harness.id) };
      });
      expect(read).toEqual({
        wrong: false,
        changed: true,
        again: false,
        missing: false,
        after: { ...harness, template: 'software' },
      });
    });
  });
}
