import { describe, expect, it } from 'vitest';
import type { Store } from '../ports.ts';
import { at, harnessOf, uid } from './store-gateway-fixtures.ts';

type FixClaimSubject = () => { readonly store: Store };

export function describeStoreFixClaim(adapter: string, subject: FixClaimSubject): void {
  describe(`${adapter} store: the fix claim switch`, () => {
    it('DX-3 FL-1 stores the fix claim off, switches it on and off, and reports a missing harness', async () => {
      const harness = harnessOf(0x7600, 'gateway-fix-claim');
      const read = await subject().store.transaction(async (tx) => {
        await tx.harnesses.write.insert(harness, at);
        const before = await tx.harnesses.read.byId(harness.id);
        const on = await tx.harnesses.write.setFixClaim(harness.id, true);
        const after = await tx.harnesses.read.byId(harness.id);
        const off = await tx.harnesses.write.setFixClaim(harness.id, false);
        const missing = await tx.harnesses.write.setFixClaim(uid(0x76fd), true);
        return { before, on, after, off, missing, last: await tx.harnesses.read.byId(harness.id) };
      });
      expect(read).toEqual({
        before: { ...harness, fixClaim: false },
        on: true,
        after: { ...harness, fixClaim: true },
        off: true,
        missing: false,
        last: { ...harness, fixClaim: false },
      });
    });
  });
}
