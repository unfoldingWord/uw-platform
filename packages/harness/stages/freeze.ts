import type { Harness } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import type { HarnessScene } from '../reads/scene.ts';
import { adminRefusal, agentRefusal } from './rules.ts';

type FreezePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type FreezeInput = {
  readonly harnessId: string;
  readonly frozen: boolean;
  readonly allow: readonly string[];
};

const ALLOW_LIMIT = 100;

function shapeRefusal(input: FreezeInput): Refused | null {
  const distinct = new Set(input.allow).size === input.allow.length;
  if (!distinct || input.allow.length > ALLOW_LIMIT) {
    return refused('malformed_command', { field: 'allow' });
  }
  if (!input.frozen && input.allow.length > 0) {
    return refused('malformed_command', { why: 'lift_names_items' });
  }
  return null;
}

async function strangerIn(
  tx: StoreTransaction,
  harnessId: string,
  allow: readonly string[],
): Promise<string | null> {
  for (const itemId of allow) {
    const item = await tx.harnessItems.read.byId(itemId);
    if (item === null || item.harnessId !== harnessId) return itemId;
  }
  return null;
}

function sameFreeze(harness: Harness, input: FreezeInput): boolean {
  if (harness.frozen !== input.frozen || harness.freezeAllow.length !== input.allow.length) {
    return false;
  }
  return harness.freezeAllow.every((itemId) => input.allow.includes(itemId));
}

export async function setFreeze(
  ports: FreezePorts,
  caller: Caller,
  input: FreezeInput,
): Promise<KernelOutcome<HarnessScene>> {
  const denied = agentRefusal(caller) ?? shapeRefusal(input);
  if (denied !== null) return denied;
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.harnessStages(input.harnessId));
    const harness = await tx.harnesses.read.byId(input.harnessId);
    if (harness === null) return refused('harness_not_found', { harnessId: input.harnessId });
    const notAdmin = await adminRefusal(ports, tx, caller, harness, at);
    if (notAdmin !== null) return notAdmin;
    const stranger = await strangerIn(tx, harness.id, input.allow);
    if (stranger !== null) return refused('item_not_found', { itemId: stranger });
    const stages = await tx.harnessStages.read.forHarness(harness.id);
    if (sameFreeze(harness, input)) return accepted({ harness, stages });
    const allow = [...input.allow];
    if (!(await tx.harnesses.write.setFreeze(harness.id, input.frozen, allow))) {
      return refused('harness_not_found', { harnessId: harness.id });
    }
    await recordHarnessEvents(tx, recordContext(ports, caller, at), harness.id, [
      draft('freeze_changed', { frozen: input.frozen, allow }),
    ]);
    return accepted({ harness: { ...harness, frozen: input.frozen, freezeAllow: allow }, stages });
  });
}
