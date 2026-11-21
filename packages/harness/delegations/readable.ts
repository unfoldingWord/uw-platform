import type { Harness, Principal } from '@uw/contracts';
import { allowed, readsDelegation } from '../access.ts';
import type { Delegation, StoreTransaction } from '../ports.ts';

export async function readableDelegations(
  tx: StoreTransaction,
  actor: Principal,
  rows: readonly Delegation[],
  at: Date,
): Promise<readonly Delegation[]> {
  const harnesses = new Map<string, Harness | null>();
  for (const row of rows) {
    if (harnesses.has(row.harnessId)) continue;
    harnesses.set(row.harnessId, await tx.harnesses.read.byId(row.harnessId));
  }
  return rows.filter((row) => {
    const harness = harnesses.get(row.harnessId) ?? null;
    if (harness === null || !allowed(actor, 'read', harness, at)) return false;
    return readsDelegation(actor, row, harness, at);
  });
}
