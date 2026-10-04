import type { Harness, ItemState, Principal } from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import type { StoreTransaction } from '../ports.ts';
import type { ScenePorts } from '../reads/scene.ts';
import { approverCovers } from '../risk/domain-grants.ts';
import { readableHarnesses } from './readable.ts';
import type { DecideAbility, GateRow } from './types.ts';

type Gate = { readonly harness: Harness; readonly item: ItemState };

function decider(actor: Principal): boolean {
  return !isAgent(actor) && actor.personId !== null;
}

export function decideAbility(actor: Principal, gate: Gate, at: Date): DecideAbility {
  const { harness, item } = gate;
  const admin = decider(actor) && allowed(actor, 'admin', harness, at);
  if (!admin || item.gateStatus !== 'parked') return { can: false, reason: 'not_permitted' };
  if (!approverCovers(actor, harness.jdArea, item.riskDomains, at)) {
    return { can: false, reason: 'approver_lacks_domain_grant' };
  }
  return { can: true };
}

async function gatesIn(
  tx: StoreTransaction,
  actor: Principal,
  harness: Harness,
  at: Date,
): Promise<readonly GateRow[]> {
  if (!allowed(actor, 'admin', harness, at)) return [];
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const human = new Map(
    stages
      .filter((stage) => stage.exitGate === 'human_approval')
      .map((stage) => [stage.key, stage]),
  );
  const rows: GateRow[] = [];
  for (const item of await tx.harnessItems.read.parked(harness.id)) {
    const stage = human.get(item.stageKey);
    if (stage === undefined) continue;
    if (decideAbility(actor, { harness, item }, at).can) rows.push({ harness, stage, item });
  }
  return rows;
}

export async function decidableGates(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<readonly GateRow[]> {
  if (!decider(caller.actor)) return [];
  const rows: GateRow[] = [];
  for (const harness of await readableHarnesses(ports, tx, caller, at)) {
    rows.push(...(await gatesIn(tx, caller.actor, harness, at)));
  }
  return rows;
}
