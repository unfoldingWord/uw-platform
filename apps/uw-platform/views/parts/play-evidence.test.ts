import { describe, expect, it } from 'vitest';
import { eventSchema } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import { evidenceOf } from './play-evidence.ts';

function delegatedMergeEvent(expiresAt: string) {
  return eventSchema.parse({
    eventId: '00000000-0000-4000-8000-0000000000e1',
    harnessId: '00000000-0000-4000-8000-0000000000e2',
    itemId: '00000000-0000-4000-8000-0000000000e3',
    name: 'delegated_merge',
    position: 7,
    at: '2026-10-15T09:01:00.000Z',
    actor: 'agent:system',
    evidence: {
      decisionId: '00000000-0000-4000-8000-0000000000e4',
      delegationId: '00000000-0000-4000-8000-0000000000e5',
      personId: '00000000-0000-4000-8000-000000000001',
      email: 'rowan.test@unfoldingword.org',
      persona: 'agent:shipper',
      expiresAt,
      maxTier: 'standard',
    },
    traceId: '00000000-0000-4000-8000-0000000000e6',
    requestId: null,
  });
}

describe('MD-6 the play-by-play shows a delegated merge', () => {
  it('MD-6 says merged under a delegation until the expiry, granted by the person', () => {
    const expiresAt = '2026-10-20T00:00:00.000Z';
    const event = delegatedMergeEvent(expiresAt);
    const shown = evidenceOf(event);
    expect(shown.list).toEqual([
      `Merged under a delegation until ${formatInstant(new Date(expiresAt))}`,
    ]);
    expect(shown.facts).toContainEqual({
      label: 'Granted by',
      value: 'rowan.test@unfoldingword.org',
      identity: 'human:00000000-0000-4000-8000-000000000001',
    });
    expect(shown.facts).toContainEqual({ label: 'Persona', value: 'agent:shipper' });
  });

  it('MD-6 says the minute job took the delegated exit for the decision', () => {
    const event = eventSchema.parse({
      eventId: '00000000-0000-4000-8000-0000000000f1',
      harnessId: '00000000-0000-4000-8000-0000000000e2',
      itemId: '00000000-0000-4000-8000-0000000000e3',
      name: 'delegated_exit_claimed',
      position: 6,
      at: '2026-10-15T09:00:30.000Z',
      actor: 'agent:system',
      evidence: { decisionId: 'abcdef01-0000-4000-8000-0000000000e4' },
      traceId: '00000000-0000-4000-8000-0000000000e6',
      requestId: null,
    });
    expect(evidenceOf(event)).toEqual({
      facts: [],
      list: ['The minute job took the delegated exit for decision abcdef01'],
    });
  });
});
