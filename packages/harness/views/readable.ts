import type { Harness } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import type { StoreTransaction } from '../ports.ts';
import { readableHarness, type ScenePorts } from '../reads/scene.ts';

function byKey(left: Harness, right: Harness): number {
  if (left.key === right.key) return 0;
  return left.key < right.key ? -1 : 1;
}

export async function readableHarnesses(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<readonly Harness[]> {
  const shown: Harness[] = [];
  for (const harness of await tx.harnesses.read.list()) {
    const read = await readableHarness(ports, tx, caller, harness.id, at);
    if (read !== null) shown.push(read);
  }
  return shown.sort(byKey);
}
