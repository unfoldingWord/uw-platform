import {
  newEventSchema,
  type EventName,
  type ItemState,
  type NewHarnessEvent,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { foldItem, replay, ReplayError } from './fold.ts';

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
    expectedHead: 'abc123',
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
      expectedHead: 'abc123',
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
