import { expect, it } from 'vitest';
import { identitySchema, newEventSchema, type EventName } from '@uw/contracts';
import type { Delegation, GateDecisionRow, Store } from '../ports.ts';
import {
  at,
  decisionOf,
  hour,
  refusedBy,
  seedDecisionItem,
  seedHarness,
  uid,
} from './store-gateway-fixtures.ts';

type DelegatedSubject = () => { readonly store: Store };

const grantor = '00000000-0000-4000-8000-000000000001';

function delegationFor(base: number, harnessBase: number): Delegation {
  return {
    id: uid(base),
    personId: grantor,
    persona: identitySchema.parse('agent:shipper'),
    harnessId: uid(harnessBase),
    capability: 'merge',
    maxTier: 'standard',
    grantedAt: at,
    expiresAt: new Date(at.getTime() + hour),
    revokedAt: null,
    lapsedAt: null,
    supersedes: null,
  };
}

function delegated(base: number, delegationBase: number): GateDecisionRow {
  return {
    ...decisionOf(base, 1, `human:${grantor}`, at),
    agentActor: identitySchema.parse('agent:shipper'),
    delegationId: uid(delegationBase),
    evidence: { findings: [], gateTarget: null, connector: 'merge', next: null },
  };
}

function describeDelegatedRead(subject: DelegatedSubject): void {
  it('MD-3 reads back a delegated decision with its agent actor and delegation, and lists it as delegated', async () => {
    const row = delegated(0x8100, 0x81d0);
    const found = await subject().store.transaction(async (tx) => {
      await seedDecisionItem(tx, 0x8100, 'gateway-delegated');
      await tx.delegations.write.insert(delegationFor(0x81d0, 0x8100), uid(0x81e0));
      await tx.gateDecisions.write.insert(row);
      await tx.gateDecisions.write.insert(decisionOf(0x8100, 2, 'human:ian', at));
      return {
        forItem: await tx.gateDecisions.read.forItem(uid(0x8100 + 11)),
        since: await tx.gateDecisions.read.delegatedSince(at, 10),
        later: await tx.gateDecisions.read.delegatedSince(new Date(at.getTime() + 1), 10),
      };
    });
    expect(found.forItem).toContainEqual(row);
    expect(found.since.map((entry) => entry.id)).toContain(row.id);
    expect(found.since.every((entry) => entry.delegationId !== null)).toBe(true);
    expect(found.later.map((entry) => entry.id)).not.toContain(row.id);
  });
}

function eventOn(base: number, n: number, name: EventName, evidence: Record<string, string>) {
  return newEventSchema.parse({
    eventId: uid(base + 0xa0 + n),
    harnessId: uid(base),
    itemId: uid(base + 11),
    name,
    at: at.toISOString(),
    actor: 'agent:system',
    evidence,
    traceId: uid(base + 0xb0),
  });
}

function describeTakenDecisions(subject: DelegatedSubject): void {
  it('MD-3 lists no delegated decision the minute job has claimed or that has a connector outcome', async () => {
    const claimed = delegated(0x8d00, 0x8dd0);
    const second = { ...claimed, id: uid(0x8d00 + 0x82), traceId: uid(0x8d00 + 0x92) };
    const listed = await subject().store.transaction(async (tx) => {
      await seedDecisionItem(tx, 0x8d00, 'gateway-delegated-taken');
      await tx.delegations.write.insert(delegationFor(0x8dd0, 0x8d00), uid(0x8de0));
      await tx.gateDecisions.write.insert(claimed);
      await tx.gateDecisions.write.insert(second);
      const before = await tx.gateDecisions.read.delegatedSince(at, 10);
      await tx.harnessEvents.write.append([
        eventOn(0x8d00, 1, 'gate_approved', { decisionId: claimed.id, stage: 'ship' }),
        eventOn(0x8d00, 2, 'delegated_exit_claimed', { decisionId: claimed.id }),
        eventOn(0x8d00, 3, 'gate_approved', { decisionId: second.id, stage: 'ship' }),
      ]);
      const approvedOnly = await tx.gateDecisions.read.delegatedSince(at, 10);
      await tx.harnessEvents.write.append([
        eventOn(0x8d00, 4, 'connector_refused', { connector: 'merge', reason: 'pr_not_open' }),
      ]);
      return { before, approvedOnly, after: await tx.gateDecisions.read.delegatedSince(at, 10) };
    });
    const ids = (rows: readonly GateDecisionRow[]) => rows.map((row) => row.id);
    expect(ids(listed.before)).toEqual(expect.arrayContaining([claimed.id, second.id]));
    expect(ids(listed.approvedOnly)).toContain(second.id);
    expect(ids(listed.approvedOnly)).not.toContain(claimed.id);
    expect(ids(listed.after)).not.toContain(second.id);
  });
}

function describeAgentActorRefusals(subject: DelegatedSubject): void {
  it('MD-3 refuses an agent actor with no delegation, naming gate_decisions_agent_with_delegation', async () => {
    const outcome = await refusedBy(async (tx) => {
      await seedDecisionItem(tx, 0x8200, 'gateway-agent-no-delegation');
      await tx.gateDecisions.write.insert({
        ...decisionOf(0x8200, 1, 'human:ian', at),
        agentActor: identitySchema.parse('agent:shipper'),
      });
    }, subject().store);
    expect(outcome).toMatchObject({
      code: '23514',
      constraint: 'gate_decisions_agent_with_delegation',
    });
  });

  it('MD-3 still refuses an agent as the approver of a delegated row, naming gate_decisions_actor_is_human', async () => {
    const outcome = await refusedBy(async (tx) => {
      await seedDecisionItem(tx, 0x8300, 'gateway-agent-approver');
      await tx.delegations.write.insert(delegationFor(0x83d0, 0x8300), uid(0x83e0));
      const row = delegated(0x8300, 0x83d0);
      await tx.gateDecisions.write.insert({ ...row, actor: identitySchema.parse('agent:shipper') });
    }, subject().store);
    expect(outcome).toMatchObject({ code: '23514', constraint: 'gate_decisions_actor_is_human' });
  });
}

function describeDelegatedRowRefusals(subject: DelegatedSubject): void {
  it('MD-4 refuses a delegated row that names deploy, naming gate_decisions_delegated_approves_merge', async () => {
    const outcome = await refusedBy(async (tx) => {
      await seedDecisionItem(tx, 0x8400, 'gateway-delegated-deploy');
      await tx.delegations.write.insert(delegationFor(0x84d0, 0x8400), uid(0x84e0));
      const row = delegated(0x8400, 0x84d0);
      await tx.gateDecisions.write.insert({
        ...row,
        evidence: { ...row.evidence, connector: 'deploy' },
      });
    }, subject().store);
    expect(outcome).toMatchObject({
      code: '23514',
      constraint: 'gate_decisions_delegated_approves_merge',
    });
  });

  it('MD-3 refuses a delegation of another harness, naming gate_decisions_delegation_fk', async () => {
    const outcome = await refusedBy(async (tx) => {
      await seedDecisionItem(tx, 0x8500, 'gateway-delegated-elsewhere');
      await seedHarness(tx, 0x8600, 'gateway-delegated-other');
      await tx.delegations.write.insert(delegationFor(0x85d0, 0x8600), uid(0x85e0));
      await tx.gateDecisions.write.insert(delegated(0x8500, 0x85d0));
    }, subject().store);
    expect(outcome).toMatchObject({ code: '23503', constraint: 'gate_decisions_delegation_fk' });
  });
}

type Planted = {
  readonly base: number;
  readonly key: string;
  readonly delegation?: Partial<Delegation>;
  readonly row: (row: GateDecisionRow) => GateDecisionRow;
};

function plantDelegated(subject: DelegatedSubject, planted: Planted) {
  const { base } = planted;
  return refusedBy(async (tx) => {
    await seedDecisionItem(tx, base, planted.key);
    const delegation = { ...delegationFor(base + 0xd0, base), ...planted.delegation };
    await tx.delegations.write.insert(delegation, uid(base + 0xe0));
    await tx.gateDecisions.write.insert(planted.row(delegated(base, base + 0xd0)));
  }, subject().store);
}

function withoutConnector(row: GateDecisionRow): GateDecisionRow {
  const evidence = Object.fromEntries(
    Object.entries(row.evidence).filter(([key]) => key !== 'connector'),
  );
  return { ...row, evidence };
}

function describeMergeEvidence(subject: DelegatedSubject): void {
  const approvesMerge = { code: '23514', constraint: 'gate_decisions_delegated_approves_merge' };
  it('MD-4 refuses a delegated row whose connector is null, naming gate_decisions_delegated_approves_merge', async () => {
    const outcome = await plantDelegated(subject, {
      base: 0x8800,
      key: 'gateway-delegated-null-connector',
      row: (row) => ({ ...row, evidence: { ...row.evidence, connector: null } }),
    });
    expect(outcome).toMatchObject(approvesMerge);
  });

  it('MD-4 refuses a delegated row that names no connector, naming gate_decisions_delegated_approves_merge', async () => {
    const outcome = await plantDelegated(subject, {
      base: 0x8900,
      key: 'gateway-delegated-no-connector',
      row: withoutConnector,
    });
    expect(outcome).toMatchObject(approvesMerge);
  });
}

function describeLentBinding(subject: DelegatedSubject): void {
  const binding = { code: '23503', constraint: 'gate_decisions_lent_binding_fk' };
  it('MD-3 refuses a delegated row naming a build delegation, naming gate_decisions_lent_binding_fk', async () => {
    const outcome = await plantDelegated(subject, {
      base: 0x8a00,
      key: 'gateway-delegated-build',
      delegation: { capability: 'build', maxTier: null },
      row: (row) => row,
    });
    expect(outcome).toMatchObject(binding);
  });

  it('MD-3 refuses an agent actor other than the delegation persona, the system included', async () => {
    const outcomes = [];
    for (const [base, actor] of [
      [0x8b00, 'agent:builder'],
      [0x8c00, 'agent:system'],
    ] as const) {
      outcomes.push(
        await plantDelegated(subject, {
          base,
          key: `gateway-delegated-${actor.slice(6)}`,
          row: (row) => ({ ...row, agentActor: identitySchema.parse(actor) }),
        }),
      );
    }
    expect(outcomes).toMatchObject([binding, binding]);
  });

  it('MD-3 refuses a delegated row whose approver is not the grantor, naming gate_decisions_lent_binding_fk', async () => {
    const outcome = await plantDelegated(subject, {
      base: 0x8e00,
      key: 'gateway-delegated-other-approver',
      row: (row) => ({ ...row, actor: identitySchema.parse('human:ian') }),
    });
    expect(outcome).toMatchObject(binding);
  });
}

export function describeDelegatedDecisions(subject: DelegatedSubject): void {
  describeDelegatedRead(subject);
  describeTakenDecisions(subject);
  describeAgentActorRefusals(subject);
  describeDelegatedRowRefusals(subject);
  describeMergeEvidence(subject);
  describeLentBinding(subject);
}
