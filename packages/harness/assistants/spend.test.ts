import { eventSchema, type HarnessEvent } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { minorOf, monthStart, spentOf } from './spend.ts';

const ceiling = 50;

function finished(costMicros: number | null): HarnessEvent {
  return eventSchema.parse({
    eventId: '00000000-0000-4000-8000-0000000000f1',
    harnessId: '00000000-0000-4000-8000-0000000000a1',
    itemId: null,
    position: 1,
    name: 'assistant_turn_finished',
    at: '2026-10-02T09:00:00.000Z',
    actor: 'agent:ingest',
    evidence: {
      requestId: '00000000-0000-4000-8000-0000000000b1',
      turnId: '00000000-0000-4000-8000-0000000000c1',
      outcome: 'ended',
      turns: 1,
      inputTokens: 10,
      outputTokens: 5,
      costMicros,
      tools: [],
    },
    traceId: '00000000-0000-4000-8000-0000000000e1',
    requestId: null,
  });
}

describe('PA-3 an assistant month is summed in minor units as the run steps convert them', () => {
  it('converts ten thousand micro-units to one minor unit, rounding half up', () => {
    expect(minorOf(20_000_000, ceiling)).toBe(2000);
    expect(minorOf(4_999, ceiling)).toBe(0);
    expect(minorOf(5_000, ceiling)).toBe(1);
    expect(minorOf(0, ceiling)).toBe(0);
  });

  it('counts a turn of unknown cost at the role ceiling', () => {
    expect(minorOf(null, ceiling)).toBe(ceiling);
  });

  it('sums the finished turns and ignores any other event', () => {
    const other: HarnessEvent = { ...finished(30_000), name: 'assistant_turn_started' };
    expect(spentOf([finished(20_000), finished(null), other], ceiling)).toBe(2 + ceiling);
  });

  it('starts the month at midnight UTC on its first day', () => {
    expect(monthStart(new Date('2026-10-31T23:59:59.000Z')).toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(monthStart(new Date('2026-11-01T00:00:00.000Z')).toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
  });
});
