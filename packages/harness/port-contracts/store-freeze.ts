import { describe, expect, it } from 'vitest';
import { defaultCiChecks } from '@uw/contracts';
import type { Store } from '../ports.ts';
import { at, harnessOf, uid } from './store-gateway-fixtures.ts';

type FreezeSubject = () => { readonly store: Store };

export function describeStoreFreeze(adapter: string, subject: FreezeSubject): void {
  describe(`store freeze and required checks on ${adapter}`, () => {
    it('DX-3 stores the required checks and sets, then lifts, a freeze', async () => {
      const harness = {
        ...harnessOf(0x7500, 'gateway-freeze'),
        requiredChecks: [...defaultCiChecks],
      };
      const allowed = uid(0x7501);
      const read = await subject().store.transaction(async (tx) => {
        await tx.harnesses.write.insert(harness, at);
        const set = await tx.harnesses.write.setFreeze(harness.id, true, [allowed]);
        const frozen = await tx.harnesses.read.byId(harness.id);
        const lifted = await tx.harnesses.write.setFreeze(harness.id, false, []);
        const missing = await tx.harnesses.write.setFreeze(uid(0x7599), true, []);
        return { set, frozen, lifted, missing, after: await tx.harnesses.read.byId(harness.id) };
      });
      expect(read).toEqual({
        set: true,
        frozen: { ...harness, frozen: true, freezeAllow: [allowed] },
        lifted: true,
        missing: false,
        after: { ...harness, frozen: false, freezeAllow: [] },
      });
    });
  });
}
