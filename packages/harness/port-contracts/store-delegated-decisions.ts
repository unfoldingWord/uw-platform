import { expect, it } from 'vitest';
import { identitySchema } from '@uw/contracts';
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

export function describeDelegatedDecisions(subject: DelegatedSubject): void {
  describeDelegatedRead(subject);
  describeAgentActorRefusals(subject);
  describeDelegatedRowRefusals(subject);
}
