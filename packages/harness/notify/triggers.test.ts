import {
  eventSchema,
  harnessSchema,
  type EventName,
  type Grant,
  type Harness,
  type HarnessEvent,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { recipientsOf } from './recipients.ts';
import { triggersOf } from './triggers.ts';

function harnessOf(jdArea: string): Harness {
  return harnessSchema.parse({
    id: harnessId,
    key: 'software',
    jdArea,
    template: 'software',
    repository: null,
    paused: false,
    hostedBuilderEnabled: false,
  });
}

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000b1';

function event(
  position: number,
  name: EventName,
  evidence: HarnessEvent['evidence'] = {},
): HarnessEvent {
  return eventSchema.parse({
    eventId: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
    harnessId,
    itemId,
    name,
    position,
    at: '2026-10-03T09:00:00.000Z',
    actor: 'agent:builder',
    evidence,
    traceId: '00000000-0000-4000-8000-0000000000c1',
    requestId: null,
  });
}

const runFailure = { runId: itemId, step: null, why: 'retries_exhausted', detail: null };
const comment = {
  source: 'zulip',
  messageId: 1,
  topic: 'software',
  personId: null,
  email: 'ana@example.org',
  text: 'approve',
  truncated: false,
};

const submitted = (position: number, result: string) =>
  event(position, 'submitted_to_gate', {
    stage: 'ship',
    result,
    to: null,
    expectedHead: null,
    pullRequest: null,
    evidence: {},
  });

describe('the events that wake a person', () => {
  it('names the four triggers, strongest first and then by position', () => {
    const triggers = triggersOf([
      event(1, 'stage_advanced', { from: 'build', to: 'check' }),
      event(2, 'run_failed', runFailure),
      submitted(3, 'parked'),
      event(4, 'delegation_lapsed', { delegationId: itemId, why: 'revoked' }),
    ]);
    expect(triggers.map(({ event: found, reason }) => [found.position, reason])).toEqual([
      [3, 'gate_waiting'],
      [4, 'delegation_lapsed'],
      [2, 'run_failed'],
      [1, 'stage_advanced'],
    ]);
  });

  it('wakes nobody for a submit that advanced or failed its checks', () => {
    expect(triggersOf([submitted(1, 'advanced'), submitted(2, 'checks_failed')])).toEqual([]);
  });

  it('wakes nobody for a topic link, a comment or a release', () => {
    const quiet = [
      event(1, 'zulip_topic_linked', { topic: 'software' }),
      event(2, 'comment_recorded', comment),
      event(3, 'item_released', { holder: 'human:ian' }),
    ];
    expect(triggersOf(quiet)).toEqual([]);
  });
});

describe('the hand-off wake', () => {
  const personId = '00000000-0000-4000-8000-000000000301';
  const handed = event(9, 'handed_to_person', {
    personId,
    why: 'review_rounds_exhausted',
    rounds: 3,
  });
  const scope = (grants: readonly Grant[]) => ({
    trigger: { event: handed, reason: 'handed_to_person' as const },
    harness: harnessOf('80-89'),
    item: null,
    run: null,
    delegation: null,
    holders: [{ personId, email: 'p@example.org', grants: [...grants] }],
    delegationPerson: () => null,
    at: new Date('2026-10-03T09:00:00.000Z'),
  });

  it('PE-6 a hand-off wakes the person it names, when they can still read the harness', () => {
    expect(triggersOf([handed]).map((trigger) => trigger.reason)).toEqual(['handed_to_person']);
    const reader: Grant = {
      grantId: personId,
      role: 'viewer',
      scopeKind: 'jd_area',
      scopeArea: '80-89',
      expiresAt: null,
    };
    expect(recipientsOf(scope([reader]))).toEqual([personId]);
    expect(recipientsOf(scope([]))).toEqual([]);
  });
});
