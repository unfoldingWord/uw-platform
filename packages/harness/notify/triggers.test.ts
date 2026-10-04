import { eventSchema, type EventName, type HarnessEvent } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { triggersOf } from './triggers.ts';

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
    actor: 'agent:system',
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
