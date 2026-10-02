import { delegationIdOf, type Harness, type Principal } from '@uw/contracts';
import { bareAgent, ownerBound } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordItemEvents, type RecordContext } from '../items/record.ts';
import { refused, type Refused } from '../outcome.ts';
import type { Delegation, Ports, StoreTransaction } from '../ports.ts';
import { beatPrincipal, personaMatches } from './beat.ts';
import { assertDelegationLive, recordLapse } from './live.ts';

type ActingPorts = Pick<Ports, 'grants'>;

export type ActingInput = {
  readonly caller: Caller;
  readonly harness: Harness;
  readonly delegationId: string | null;
  readonly context: RecordContext;
};

export function isRefusal(value: Principal | Refused): value is Refused {
  return 'status' in value;
}

function needsDelegation(actor: Principal): boolean {
  return !actor.interactive || bareAgent(actor.identity);
}

async function freshGrants(
  ports: ActingPorts,
  tx: StoreTransaction,
  actor: Principal,
  at: Date,
): Promise<Principal> {
  if (actor.personId === null) return actor;
  return { ...actor, grants: [...(await ports.grants.resolveIn(tx, actor.personId, at))] };
}

function boundTo(actor: Principal, harness: Harness, delegation: Delegation): boolean {
  return delegation.harnessId === harness.id && personaMatches(actor.identity, delegation);
}

function presentsNamedDelegation(actor: Principal, delegationId: string | null): boolean {
  const named = delegationIdOf(actor.identity);
  return named === null || named === delegationId;
}

async function delegatedPrincipal(
  ports: ActingPorts,
  tx: StoreTransaction,
  input: ActingInput,
  delegationId: string,
): Promise<Principal | Refused> {
  const { caller, harness, context } = input;
  const found = await tx.delegations.read.byId(delegationId);
  if (found === null || found.personId !== caller.actor.personId) {
    return refused('delegation_not_found', { delegationId });
  }
  if (!boundTo(caller.actor, harness, found)) return refused('not_permitted', { delegationId });
  const liveness = await assertDelegationLive(tx, ports, delegationId, context.at);
  const delegation = liveness.delegation ?? found;
  if (!liveness.live) {
    if (liveness.why !== null) await recordLapse(tx, context, delegation, liveness.why);
    return refused('delegation_lapsed', { delegationId, why: liveness.why });
  }
  if (delegation.capability === 'none') {
    return refused('not_permitted', { delegationId, why: 'delegation_capability' });
  }
  return beatPrincipal(delegation, liveness.grants, harness.jdArea, context.at);
}

export async function actingPrincipal(
  ports: ActingPorts,
  tx: StoreTransaction,
  input: ActingInput,
): Promise<Principal | Refused> {
  const { caller, delegationId, context } = input;
  if (!ownerBound(caller.actor)) return refused('not_permitted', { why: 'owner_mismatch' });
  if (!presentsNamedDelegation(caller.actor, delegationId)) {
    return refused('not_permitted', { delegationId, why: 'delegation_mismatch' });
  }
  if (delegationId !== null) return delegatedPrincipal(ports, tx, input, delegationId);
  if (needsDelegation(caller.actor)) {
    return refused('delegation_required', { actor: caller.actor.identity });
  }
  return freshGrants(ports, tx, caller.actor, context.at);
}

export async function recordDelegationRequired(
  tx: StoreTransaction,
  context: RecordContext,
  itemId: string,
  stageKey: string,
): Promise<Refused> {
  await recordItemEvents(tx, context, itemId, [draft('delegation_required', { stage: stageKey })]);
  return refused('delegation_required', { stage: stageKey });
}
