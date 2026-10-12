import type { Harness, ItemState, Principal, Stage } from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import type { StoreTransaction } from '../ports.ts';
import { itemScene, type ScenePorts } from '../reads/scene.ts';
import { approverCovers } from '../risk/domain-grants.ts';
import { readableHarnesses } from './readable.ts';
import { VIEW_LIMIT, type DecideAbility, type GateList, type GateRow } from './types.ts';

type Gate = { readonly harness: Harness; readonly stage: Stage; readonly item: ItemState };

function decider(actor: Principal): boolean {
  return !isAgent(actor) && actor.personId !== null;
}

export function decideAbility(actor: Principal, gate: Gate, at: Date): DecideAbility {
  const { harness, stage, item } = gate;
  const atPersonGate = stage.exitGate === 'human_approval' && stage.key === item.stageKey;
  if (!atPersonGate || item.gateStatus !== 'parked') {
    return { can: false, reason: 'item_not_at_gate' };
  }
  const admin = decider(actor) && allowed(actor, 'admin', harness, at);
  if (!admin) return { can: false, reason: 'not_permitted' };
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
): Promise<GateList> {
  if (!allowed(actor, 'admin', harness, at)) return { rows: [], capped: false };
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const human = new Map(
    stages
      .filter((stage) => stage.exitGate === 'human_approval')
      .map((stage) => [stage.key, stage]),
  );
  const parked = await tx.harnessItems.read.parked(harness.id, VIEW_LIMIT);
  const rows: GateRow[] = [];
  for (const item of parked) {
    const stage = human.get(item.stageKey);
    if (stage === undefined) continue;
    if (decideAbility(actor, { harness, stage, item }, at).can) rows.push({ harness, stage, item });
  }
  return { rows, capped: parked.length === VIEW_LIMIT };
}

export async function decidableGates(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<GateList> {
  if (!decider(caller.actor)) return { rows: [], capped: false };
  const rows: GateRow[] = [];
  let capped = false;
  for (const harness of await readableHarnesses(ports, tx, caller, at)) {
    const listed = await gatesIn(tx, caller.actor, harness, at);
    rows.push(...listed.rows);
    capped ||= listed.capped;
  }
  return { rows, capped };
}

export async function gateDecided(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  itemId: string,
  at: Date,
): Promise<boolean> {
  const scene = await itemScene(ports, tx, caller, itemId, at);
  if (scene.status !== 'accepted') return false;
  return (await tx.gateDecisions.read.forItem(itemId)).length > 0;
}
