import {
  capabilityWordSchema,
  personaIdentitySchema,
  type CapabilityWord,
  type Harness,
  type Principal,
} from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents, type EventDraft } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import { storeRefusalOf } from '../port-errors.ts';
import type { Delegation, DelegationFilter, Ports, StoreTransaction } from '../ports.ts';
import { adminRefusal, agentRefusal } from '../stages/rules.ts';
import { beatPrincipal, personaMatches } from './beat.ts';
import { assertDelegationLive, recordLapse } from './live.ts';

type DelegationPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

const DELEGATION_DEFAULT_MS = 90 * 24 * 60 * 60 * 1000;

export type GrantInput = {
  readonly harnessId: string;
  readonly persona: string;
  readonly capability: CapabilityWord;
  readonly expiresAt: Date | null;
  readonly supersedes: string | null;
};

export type DelegationCommands = {
  grant(caller: Caller, input: GrantInput): Promise<KernelOutcome<Delegation>>;
  revoke(
    caller: Caller,
    input: { readonly delegationId: string },
  ): Promise<KernelOutcome<Delegation>>;
  live(caller: Caller, filter: DelegationFilter): Promise<KernelOutcome<readonly Delegation[]>>;
  beat(
    caller: Caller,
    input: { readonly delegationId: string },
  ): Promise<KernelOutcome<{ readonly delegation: Delegation; readonly principal: Principal }>>;
};

async function supersession(
  tx: StoreTransaction,
  personId: string,
  next: Delegation,
  at: Date,
): Promise<readonly EventDraft[] | Refused> {
  if (next.supersedes === null) return [];
  const old = await tx.delegations.read.byId(next.supersedes);
  if (old === null) return refused('delegation_not_found', { delegationId: next.supersedes });
  const sameBinding =
    old.personId === personId && old.harnessId === next.harnessId && old.persona === next.persona;
  if (!sameBinding) return refused('not_permitted', { delegationId: old.id });
  if (old.revokedAt !== null) return refused('stale_version', { delegationId: old.id });
  if (old.lapsedAt !== null || old.expiresAt.getTime() <= at.getTime()) return [];
  const changed = await tx.delegations.write.revoke(old.id, at);
  if (!changed) return refused('stale_version', { delegationId: old.id });
  return [draft('delegation_revoked', { delegationId: old.id })];
}

function draftOf(
  ports: DelegationPorts,
  caller: Caller,
  harness: Harness,
  input: GrantInput,
  at: Date,
): Delegation | Refused {
  const persona = personaIdentitySchema.safeParse(input.persona);
  const capability = capabilityWordSchema.safeParse(input.capability);
  if (!persona.success || !capability.success || caller.actor.personId === null) {
    return refused('malformed_command', { persona: input.persona });
  }
  const expiresAt = input.expiresAt ?? new Date(at.getTime() + DELEGATION_DEFAULT_MS);
  if (expiresAt.getTime() <= at.getTime()) {
    return refused('expiry_in_past', { expiresAt: expiresAt.toISOString() });
  }
  return {
    id: ports.ids.next(),
    personId: caller.actor.personId,
    persona: persona.data,
    harnessId: harness.id,
    capability: capability.data,
    grantedAt: at,
    expiresAt,
    revokedAt: null,
    lapsedAt: null,
    supersedes: input.supersedes,
  };
}

async function grantIn(
  ports: DelegationPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: GrantInput,
  at: Date,
): Promise<KernelOutcome<Delegation>> {
  const harness = await tx.harnesses.read.byId(input.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: input.harnessId });
  const denied = await adminRefusal(ports, tx, caller, harness, at);
  if (denied !== null) return denied;
  const next = draftOf(ports, caller, harness, input, at);
  if ('status' in next) return next;
  const revoked = await supersession(tx, next.personId, next, at);
  if ('status' in revoked) return revoked;
  await tx.delegations.write.insert(next, caller.traceId);
  await recordHarnessEvents(tx, recordContext(ports, caller, at), harness.id, [
    ...revoked,
    draft('delegation_granted', {
      delegationId: next.id,
      personId: next.personId,
      persona: next.persona,
      capability: next.capability,
      expiresAt: next.expiresAt.toISOString(),
      supersedes: next.supersedes,
    }),
  ]);
  return accepted(next);
}

async function mayRevoke(
  ports: DelegationPorts,
  tx: StoreTransaction,
  caller: Caller,
  delegation: Delegation,
  at: Date,
): Promise<Refused | null> {
  if (caller.actor.personId === delegation.personId) return null;
  const harness = await tx.harnesses.read.byId(delegation.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: delegation.harnessId });
  return adminRefusal(ports, tx, caller, harness, at);
}

async function revokeIn(
  ports: DelegationPorts,
  tx: StoreTransaction,
  caller: Caller,
  delegationId: string,
  at: Date,
): Promise<KernelOutcome<Delegation>> {
  const delegation = await tx.delegations.read.byId(delegationId);
  if (delegation === null) return refused('delegation_not_found', { delegationId });
  const denied = await mayRevoke(ports, tx, caller, delegation, at);
  if (denied !== null) return denied;
  if (await tx.delegations.write.revoke(delegationId, at)) {
    await recordHarnessEvents(tx, recordContext(ports, caller, at), delegation.harnessId, [
      draft('delegation_revoked', { delegationId }),
    ]);
  }
  const now = await tx.delegations.read.byId(delegationId);
  return accepted(now ?? delegation);
}

async function readableLive(
  tx: StoreTransaction,
  caller: Caller,
  filter: DelegationFilter,
  at: Date,
): Promise<readonly Delegation[]> {
  const rows = await tx.delegations.read.live(filter, at);
  const readable = new Map<string, boolean>();
  for (const row of rows) {
    if (readable.has(row.harnessId)) continue;
    const harness = await tx.harnesses.read.byId(row.harnessId);
    readable.set(row.harnessId, harness !== null && allowed(caller.actor, 'read', harness, at));
  }
  return rows.filter((row) => readable.get(row.harnessId) === true);
}

function boundTo(caller: Caller, delegation: Delegation): boolean {
  return (
    isAgent(caller.actor) &&
    caller.actor.personId === delegation.personId &&
    personaMatches(caller.actor.identity, delegation)
  );
}

async function beatIn(
  ports: DelegationPorts,
  tx: StoreTransaction,
  caller: Caller,
  delegationId: string,
  at: Date,
): Promise<KernelOutcome<{ readonly delegation: Delegation; readonly principal: Principal }>> {
  const found = await tx.delegations.read.byId(delegationId);
  if (found === null) return refused('delegation_not_found', { delegationId });
  if (!boundTo(caller, found)) return refused('not_permitted', { delegationId });
  const liveness = await assertDelegationLive(tx, ports, delegationId, at);
  if (!liveness.live) {
    if (liveness.delegation !== null && liveness.why !== null) {
      await recordLapse(tx, recordContext(ports, caller, at), liveness.delegation, liveness.why);
    }
    return refused('delegation_lapsed', { delegationId, why: liveness.why });
  }
  const harness = await tx.harnesses.read.byId(found.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: found.harnessId });
  const principal = beatPrincipal(liveness.delegation, liveness.grants, harness.jdArea, at);
  return accepted({ delegation: liveness.delegation, principal });
}

const SUPERSEDED_ONCE = 'delegations_supersedes_once';

async function grantOnce(
  ports: DelegationPorts,
  caller: Caller,
  input: GrantInput,
  at: Date,
): Promise<KernelOutcome<Delegation>> {
  try {
    return await ports.store.transaction((tx) => grantIn(ports, tx, caller, input, at));
  } catch (error) {
    if (storeRefusalOf(error)?.constraint !== SUPERSEDED_ONCE) throw error;
    return refused('stale_version', { delegationId: input.supersedes });
  }
}

export function createDelegationCommands(ports: DelegationPorts): DelegationCommands {
  return {
    grant: async (caller, input) => {
      const at = ports.clock.now();
      const agent = agentRefusal(caller);
      if (agent !== null) return agent;
      return grantOnce(ports, caller, input, at);
    },
    revoke: async (caller, input) => {
      const at = ports.clock.now();
      const agent = agentRefusal(caller);
      if (agent !== null) return agent;
      return ports.store.transaction((tx) => revokeIn(ports, tx, caller, input.delegationId, at));
    },
    live: async (caller, filter) => {
      const at = ports.clock.now();
      return accepted(await ports.store.transaction((tx) => readableLive(tx, caller, filter, at)));
    },
    beat: async (caller, input) => {
      const at = ports.clock.now();
      return ports.store.transaction((tx) => beatIn(ports, tx, caller, input.delegationId, at));
    },
  };
}
