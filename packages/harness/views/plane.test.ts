import { eventSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { refusalReasons } from './plane.ts';

const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

function refusal(reason: string | null) {
  return eventSchema.parse({
    eventId: uid(1),
    harnessId: uid(2),
    itemId: uid(3),
    name: 'gate_refused_to_agent',
    at: '2026-10-20T12:00:00.000Z',
    actor: 'agent:builder',
    evidence: { decision: 'approve', stage: 'ship', reason },
    traceId: uid(4),
    requestId: null,
    position: 1,
  });
}

describe('refusalReasons', () => {
  it('counts an agent refused at a gate', () => {
    expect(refusalReasons(refusal(null))).toEqual(['gate_refused_to_agent']);
  });

  it('leaves a delegated hold out of the refusals', () => {
    expect(refusalReasons(refusal('shadow'))).toEqual([]);
  });
});
