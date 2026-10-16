import { eventSchema, type HarnessEvent } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { refuteTallies } from './refutes.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const runId = '00000000-0000-4000-8000-0000000000d1';
let position = 0;

function event(name: string, actor: string, evidence: Record<string, unknown>): HarnessEvent {
  position += 1;
  return eventSchema.parse({
    eventId: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
    harnessId,
    itemId: '00000000-0000-4000-8000-0000000000b1',
    name,
    position,
    at: '2026-10-15T09:00:00.000Z',
    actor,
    evidence,
    traceId: '00000000-0000-4000-8000-0000000000c1',
    requestId: null,
  });
}

const findings = [
  { text: 'The lease is never renewed.', weight: 'real' },
  { text: 'A year of clock skew breaks it.', weight: 'theoretical' },
];
const review = {
  reviewer: 'uw-reviewer',
  provider: 'deepinfra',
  model: 'z-ai/glm-5.3',
  verdict: 'request_changes',
  reviewId: 9300000001,
  findings,
};
const completed = event('run_completed', 'agent:reviewer', {
  runId,
  result: 'review_posted',
  gates: [],
  review,
});
const refuted = event('finding_refuted', 'human:00000000-0000-4000-8000-000000000001', {
  runId,
  persona: 'agent:reviewer',
  reviewer: 'uw-reviewer',
  index: 1,
  weight: 'theoretical',
  text: 'A year of clock skew breaks it.',
});

describe('RV-2 the refute rate per Reviewer identity', () => {
  it('counts findings from review records and refutations by the persona that wrote them', () => {
    expect(refuteTallies([completed, refuted])).toEqual([
      { harnessId, persona: 'agent:reviewer', findings: 2, refuted: 1 },
    ]);
  });

  it('counts nothing for a run with no review', () => {
    const builder = event('run_completed', 'agent:builder', {
      runId,
      result: 'submitted',
      gates: [],
      review: null,
    });
    expect(refuteTallies([builder])).toEqual([]);
  });
});
