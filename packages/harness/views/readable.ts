import type { Harness } from '@uw/contracts';
import type { HarnessCursor } from './types.ts';
import type { Caller } from '../caller.ts';
import type { StoreTransaction } from '../ports.ts';
import { admittedHarnesses, readableHarness, type ScenePorts } from '../reads/scene.ts';

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
  return [...(await admittedHarnesses(ports, tx, caller, at))].sort(byKey);
}

export async function harnessCursors(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<readonly HarnessCursor[]> {
  const ids = (await readableHarnesses(ports, tx, caller, at)).map((harness) => harness.id);
  const positions = await tx.harnessEvents.read.lastPositions(ids);
  const latest = new Map(positions.map((entry) => [entry.harnessId, entry.position]));
  return ids.map((harnessId) => ({ harnessId, cursor: latest.get(harnessId) ?? 0 }));
}

export async function harnessCursor(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  harnessId: string,
  at: Date,
): Promise<number> {
  const harness = await readableHarness(ports, tx, caller, harnessId, at);
  return harness === null ? 0 : tx.harnessEvents.read.lastPosition(harness.id);
}
