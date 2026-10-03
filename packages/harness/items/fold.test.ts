import {
  newEventSchema,
  eventNames,
  type EventName,
  type ItemState,
  type NewHarnessEvent,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { foldItem, replay, ReplayError, steppedNames, unchangedNames } from './fold.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000b1';
const person = 'human:00000000-0000-4000-8000-000000000001';
const builder = 'agent:builder';
const start = Date.parse('2026-10-01T09:00:00.000Z');
const lease = '2026-10-01T10:00:00.000Z';

function event(n: number, name: EventName, evidence: Record<string, unknown>): NewHarnessEvent {
  return newEventSchema.parse({
    eventId: `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
    harnessId,
    itemId,
    name,
    at: new Date(start + n * 1000).toISOString(),
    actor: person,
    evidence,
    traceId: '00000000-0000-4000-8000-0000000000e1',
    requestId: null,
  });
}

function created(stage: string): NewHarnessEvent {
  return event(1, 'item_created', { stage, title: 'Item', pageId: null, priority: 0, due: null });
}

function claimed(holder: string, kind: 'person' | 'agent', leaseExpiresAt: string | null) {
  return event(2, 'item_claimed', {
    holder,
    claimantKind: kind,
    delegationId: null,
    leaseExpiresAt,
  });
}

function released(holder: string): NewHarnessEvent {
  return event(3, 'item_released', { holder });
}

function parked(to: string): NewHarnessEvent {
  return event(4, 'submitted_to_gate', {
    stage: 'check',
    result: 'parked',
    to,
    expectedHead: 'a'.repeat(40),
    pullRequest: null,
    evidence: {},
  });
}

function advanced(from: string, to: string | null): NewHarnessEvent {
  return event(5, 'stage_advanced', { from, to });
}

function takenOver(holder: string): NewHarnessEvent {
  return event(6, 'gate_taken_over', {
    decisionId: '00000000-0000-4000-8000-0000000000d1',
    stage: 'ship',
    holder,
  });
}

describe("KN-4 replay is a pure reducer over an item's events", () => {
  it('gives the holder, kind and lease of a claim', () => {
    expect(replay([created('build'), claimed(builder, 'agent', lease)])).toMatchObject({
      stageKey: 'build',
      holder: builder,
      claimantKind: 'agent',
      leaseExpiresAt: lease,
    });
  });

  it('clears all four holder fields on release', () => {
    const state = replay([created('build'), claimed(builder, 'agent', lease), released(builder)]);
    expect(state).toMatchObject({
      holder: null,
      claimantKind: null,
      delegationId: null,
      leaseExpiresAt: null,
    });
  });

  it('parks at the target and clears the holder on a parked submit', () => {
    const state = replay([created('check'), claimed(builder, 'agent', lease), parked('package')]);
    expect(state).toMatchObject({
      holder: null,
      gateStatus: 'parked',
      gateTarget: 'package',
      expectedHead: 'a'.repeat(40),
      branchState: 'active',
    });
  });

  it('is done when a stage advances to nothing', () => {
    expect(replay([created('close'), advanced('close', null)])).toMatchObject({
      gateStatus: 'done',
      gateTarget: null,
    });
  });

  it('gives a person holder with no lease on a takeover', () => {
    const state = replay([created('ship'), claimed(builder, 'agent', lease), takenOver(person)]);
    expect(state).toMatchObject({
      holder: person,
      claimantKind: 'person',
      delegationId: null,
      leaseExpiresAt: null,
      gateStatus: 'working',
    });
  });
});

describe('KN-4 replay is deterministic and incremental', () => {
  it('is null for no events', () => {
    expect(replay([])).toBeNull();
  });

  it('gives the same state twice and equals the incremental fold', () => {
    const all = [created('build'), claimed(builder, 'agent', lease), parked('package')];
    expect(replay(all)).toEqual(replay(all));
    const prior = replay(all.slice(0, -1));
    const incremental = all.slice(-1).reduce<ItemState | null>(foldItem, prior);
    expect(replay(all)).toEqual(incremental);
  });
});

describe('KN-4 replay refuses an item event out of order', () => {
  it('refuses an event before the item was created', () => {
    expect(() => replay([claimed(builder, 'agent', lease)])).toThrow(ReplayError);
  });

  it('refuses a second creation', () => {
    expect(() => replay([created('build'), created('build')])).toThrow(ReplayError);
  });
});

const later = '2026-10-01T11:00:00.000Z';
const base = (): NewHarnessEvent[] => [created('build'), claimed(builder, 'agent', lease)];

function submitted(result: string, head: string | null, pullRequest: unknown): NewHarnessEvent {
  return event(7, 'submitted_to_gate', {
    stage: 'build',
    result,
    to: null,
    expectedHead: head,
    pullRequest,
    evidence: {},
  });
}

describe('KN-4 replay folds lease and branch events', () => {
  it('releases the holder on lease_expired', () => {
    const expired = event(7, 'lease_expired', { holder: builder, leaseExpiresAt: lease });
    expect(replay([...base(), expired])).toMatchObject({
      holder: null,
      claimantKind: null,
      delegationId: null,
      leaseExpiresAt: null,
    });
  });

  it('moves only the lease on lease_renewed', () => {
    const renewed = event(7, 'lease_renewed', { leaseExpiresAt: later });
    expect(replay([...base(), renewed])).toMatchObject({ holder: builder, leaseExpiresAt: later });
  });

  it('moves only the lease on run_step_recorded', () => {
    const step = event(7, 'run_step_recorded', {
      runId: '00000000-0000-4000-8000-0000000000f1',
      step: 'work',
      tokensIn: 1,
      tokensOut: 2,
      costBasis: 'metered',
      leaseExpiresAt: later,
    });
    expect(replay([...base(), step])).toMatchObject({ holder: builder, leaseExpiresAt: later });
  });

  it('marks the branch abandoned and then active again', () => {
    const abandoned = event(7, 'branch_abandoned', { head: null });
    const adopted = event(8, 'branch_adopted', { head: null });
    expect(replay([...base(), abandoned])?.branchState).toBe('abandoned');
    expect(replay([...base(), abandoned, adopted])?.branchState).toBe('active');
  });
});

describe('KN-4 replay folds gate and stage events', () => {
  it('sets checks_failed on the gate status and keeps the holder', () => {
    const failed = event(7, 'checks_failed', { stage: 'build', failures: ['lint'] });
    expect(replay([...base(), failed])).toMatchObject({
      gateStatus: 'checks_failed',
      holder: builder,
    });
  });

  it('moves to the next stage, working and released, on stage_advanced', () => {
    const failed = event(7, 'checks_failed', { stage: 'build', failures: ['lint'] });
    expect(replay([...base(), failed, advanced('build', 'check')])).toMatchObject({
      stageKey: 'check',
      gateStatus: 'working',
      gateTarget: null,
      holder: null,
    });
  });
});

describe('KN-4 replay folds loop edges, rejections and risk', () => {
  it('returns to a stage, working and released, on loop_edge_taken', () => {
    const looped = event(7, 'loop_edge_taken', { from: 'check', to: 'build' });
    const held = [created('check'), claimed(builder, 'agent', lease)];
    expect(replay([...held, looped])).toMatchObject({
      stageKey: 'build',
      gateStatus: 'working',
      holder: null,
      leaseExpiresAt: null,
    });
    expect(replay([...held, parked('ship'), looped])).toMatchObject({
      gateStatus: 'working',
      gateTarget: null,
    });
  });

  it('clears the park on gate_rejected', () => {
    const rejected = event(7, 'gate_rejected', {
      decisionId: '00000000-0000-4000-8000-0000000000d1',
      stage: 'check',
      findings: [],
    });
    expect(replay([...base(), parked('ship'), rejected])).toMatchObject({
      gateStatus: 'working',
      gateTarget: null,
    });
  });

  it('takes the risk tier and domains from risk_derived', () => {
    const derived = event(7, 'risk_derived', {
      paths: ['a.ts'],
      declaration: null,
      floorDomains: [],
      riskTier: 'high',
      riskDomains: ['acl', 'ledger'],
      refusal: null,
    });
    expect(replay([...base(), derived])).toMatchObject({
      riskTier: 'high',
      riskDomains: ['ledger', 'acl'],
    });
  });
});

describe('KN-17 replay never lowers risk', () => {
  const derived = (position: number, riskTier: 'low' | 'high' | null, riskDomains: string[]) =>
    event(position, 'risk_derived', {
      paths: [],
      declaration: null,
      floorDomains: [],
      riskTier,
      riskDomains,
      refusal: null,
    });

  it('keeps the higher tier and unions domains when a later derivation is null or lower', () => {
    const high = derived(7, 'high', ['migration']);
    const kept = replay([...base(), high, derived(8, null, ['acl']), derived(9, 'low', [])]);
    expect(kept).toMatchObject({ riskTier: 'high', riskDomains: ['acl', 'migration'] });
  });
});

describe('KN-4 replay folds a submit by its result', () => {
  it('records the pull request and keeps the holder on a submit that is not parked', () => {
    const request = { repo: 'unfoldingWord/uw-platform', number: 7 };
    const head = 'abc'.padEnd(40, '0');
    expect(replay([...base(), submitted('advanced', head, request)])).toMatchObject({
      pullRequest: request,
      expectedHead: head,
      branchState: 'active',
      holder: builder,
      gateStatus: 'working',
    });
  });

  it('leaves the branch and head alone when the submit has no head', () => {
    expect(replay([...base(), submitted('advanced', null, null)])).toMatchObject({
      expectedHead: null,
      branchState: 'none',
      pullRequest: null,
    });
  });
});

describe('KN-4 replay leaves state alone for events that do not fold', () => {
  it('keeps state deep-equal across gate_approved and comment_recorded', () => {
    const approved = event(7, 'gate_approved', {
      decisionId: '00000000-0000-4000-8000-0000000000d1',
      stage: 'ship',
    });
    const commented = event(8, 'comment_recorded', {});
    expect(replay([...base(), approved, commented])).toEqual(replay(base()));
  });

  it('names every event either as a fold step or as unchanged, never both', () => {
    const named = [...steppedNames, ...unchangedNames, 'item_created'].toSorted();
    expect(named).toEqual([...eventNames].toSorted());
  });
});

describe('KN-4 replay refuses an event that is not about the item', () => {
  it('refuses an event for another item and a harness-level event', () => {
    const other = {
      ...claimed(builder, 'agent', lease),
      itemId: '00000000-0000-4000-8000-0000000000b2',
    };
    const harnessLevel = { ...claimed(builder, 'agent', lease), itemId: null };
    expect(() => replay([created('build'), other])).toThrow(ReplayError);
    expect(() => replay([created('build'), harnessLevel])).toThrow(ReplayError);
  });
});
