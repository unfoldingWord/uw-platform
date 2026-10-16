import { identitySchema, itemStateSchema, type ItemState } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { AGENT_HOLD_MS, PERSON_HOLD_MS, heldTooLong, holderOf } from './holder.ts';

const since = '2026-10-15T08:00:00.000Z';
const base: ItemState = itemStateSchema.parse({
  itemId: '00000000-0000-4000-8000-0000000000b1',
  harnessId: '00000000-0000-4000-8000-0000000000a1',
  stageKey: 'check',
  title: 'Hold the ball',
  pageId: null,
  priority: 0,
  due: null,
  holder: null,
  claimantKind: null,
  delegationId: null,
  leaseExpiresAt: null,
  gateStatus: 'working',
  gateTarget: null,
  branchState: 'none',
  expectedHead: null,
  riskTier: null,
  riskDomains: [],
  pullRequest: null,
  issue: null,
  zulipTopic: null,
  heldSince: since,
});
const person = identitySchema.parse('human:00000000-0000-4000-8000-000000000001');
const agent = identitySchema.parse('agent:reviewer');
const checks = { exitGate: 'checks' as const };
const human = { exitGate: 'human_approval' as const };

describe('OB-2 who holds the ball', () => {
  it('OB-2 is the claimant, a person or an agent', () => {
    const held = { ...base, holder: person, claimantKind: 'person' as const };
    expect(holderOf(held, checks, false)).toEqual({
      role: 'claimant',
      kind: 'person',
      identity: person,
      since: new Date(since),
    });
  });

  it('OB-2 is the Reviewer when the claim rides a review delegation', () => {
    const held = { ...base, holder: agent, claimantKind: 'agent' as const };
    expect(holderOf(held, checks, true)).toMatchObject({
      role: 'reviewer',
      kind: 'agent',
      identity: agent,
    });
  });

  it('OB-2 is a person who may decide while the item is parked at a human gate', () => {
    const parked = { ...base, gateStatus: 'parked' as const };
    expect(holderOf(parked, human, false)).toEqual({
      role: 'decider',
      kind: 'person',
      identity: null,
      since: new Date(since),
    });
    expect(holderOf(parked, checks, false)).toBeNull();
  });

  it('OB-2 is nobody for an unclaimed working item or a done one', () => {
    expect(holderOf(base, checks, false)).toBeNull();
    expect(
      holderOf(
        { ...base, holder: person, claimantKind: 'person', gateStatus: 'done' },
        checks,
        false,
      ),
    ).toBeNull();
  });
});

describe('OB-2 how long is too long', () => {
  it('OB-2 holds too long past 24 hours for a person and 2 hours for an agent, never without a since', () => {
    const start = new Date(since).getTime();
    const personHolder = holderOf(
      { ...base, holder: person, claimantKind: 'person' },
      checks,
      false,
    );
    const agentHolder = holderOf({ ...base, holder: agent, claimantKind: 'agent' }, checks, false);
    expect(heldTooLong(personHolder, new Date(start + PERSON_HOLD_MS))).toBeNull();
    expect(heldTooLong(personHolder, new Date(start + PERSON_HOLD_MS + 1))).toBe('person');
    expect(heldTooLong(agentHolder, new Date(start + AGENT_HOLD_MS + 1))).toBe('agent');
    const unknown = holderOf(
      { ...base, heldSince: null, holder: agent, claimantKind: 'agent' },
      checks,
      false,
    );
    expect(heldTooLong(unknown, new Date(start + PERSON_HOLD_MS * 10))).toBeNull();
  });
});
