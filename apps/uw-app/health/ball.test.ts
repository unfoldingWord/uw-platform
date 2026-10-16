import { harnessSchema, identitySchema, itemStateSchema } from '@uw/contracts';
import type { Holds, Silence } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { heldIndicator, silenceIndicator } from './ball.ts';

const at = new Date('2026-10-15T12:00:00.000Z');
const minute = 60_000;
const harness = harnessSchema.parse({
  id: '00000000-0000-4000-8000-0000000000a1',
  key: 'tc-admin-app',
  template: 'check-only',
  jdArea: '80-89',
  repository: 'unfoldingWord/tc-admin-app',
  hostedBuilderEnabled: false,
  paused: false,
});
const item = itemStateSchema.parse({
  itemId: '00000000-0000-4000-8000-0000000000b1',
  harnessId: harness.id,
  stageKey: 'check',
  title: 'Wait for a review',
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
});
const quiet: Silence = { harness, level: 'ok', waiting: [], uncounted: 0, lastReviewStepAt: null };
const none: Holds = { person: [], agent: [], uncounted: { person: 0, agent: 0 }, capped: false };
const holder = {
  role: 'claimant' as const,
  kind: 'person' as const,
  identity: identitySchema.parse('human:ian'),
  since: at,
};

describe('OB-1 the silence alarm indicator', () => {
  it('OB-1 says nothing waits when every harness is ok', () => {
    expect(silenceIndicator([quiet], at)).toEqual({
      name: 'silence_alarm',
      status: 'ok',
      detail: 'No item has waited in Check over 45 minutes without a review step',
    });
  });

  it('OB-1 goes red with the longest wait and how long the harness has been quiet', () => {
    const red: Silence = {
      ...quiet,
      level: 'red',
      waiting: [{ item, enteredAt: new Date(at.getTime() - 95 * minute) }],
    };
    expect(silenceIndicator([quiet, red], at)).toEqual({
      name: 'silence_alarm',
      status: 'red',
      detail:
        '1 waiting in Check, the longest 1 h 35 min on tc-admin-app, with no review step for over 90 minutes',
    });
  });

  it('OB-4 says how many bot pull requests it left out', () => {
    expect(silenceIndicator([{ ...quiet, uncounted: 2 }], at).detail).toBe(
      'No item has waited in Check over 45 minutes without a review step; not counting 2 by bot accounts',
    );
  });
});

describe('OB-2 the two holder indicators', () => {
  it('OB-2 counts items with a person over 24 hours and with an agent over 2 hours', () => {
    expect(heldIndicator('held_by_person', none)).toEqual({
      name: 'held_by_person',
      status: 'ok',
      detail: 'None over 24 hours',
    });
    const held = { ...none, person: [{ harness, item, holder }] };
    expect(heldIndicator('held_by_person', held)).toEqual({
      name: 'held_by_person',
      status: 'amber',
      detail: '1 item with a person over 24 hours',
    });
    expect(heldIndicator('held_by_agent', none).detail).toBe('None over 2 hours');
  });

  it('OB-4 says how many bot pull requests each count left out', () => {
    const left = { ...none, uncounted: { person: 0, agent: 3 } };
    expect(heldIndicator('held_by_agent', left).detail).toBe(
      'None over 2 hours; not counting 3 by bot accounts',
    );
    expect(heldIndicator('held_by_person', left).detail).toBe('None over 24 hours');
  });
});
