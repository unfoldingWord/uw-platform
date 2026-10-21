import { eventSchema, type HarnessEvent } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { refusedByEngine } from './backoff.ts';

const runId = '00000000-0000-4000-8000-0000000000d1';
const person = '00000000-0000-4000-8000-000000000001';
let position = 0;

function event(name: string, actor: string, evidence: Record<string, unknown>): HarnessEvent {
  position += 1;
  return eventSchema.parse({
    eventId: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
    harnessId: '00000000-0000-4000-8000-0000000000a1',
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

const failed = (why: string) =>
  event('run_failed', 'agent:reviewer', { runId, step: 'work', why, detail: null });
const handed = event('handed_to_person', 'agent:reviewer', {
  personId: person,
  why: 'engine_refused',
  rounds: null,
});
const released = event('item_released', `human:${person}`, { holder: `human:${person}` });

describe('GD-3 an engine refusal holds the item until a person acts', () => {
  it('holds after an engine_refused failure and after the hand-off', () => {
    expect(refusedByEngine([failed('engine_refused'), handed])).toBe(true);
  });

  it('lets go once a person acts on the item', () => {
    expect(refusedByEngine([failed('engine_refused'), handed, released])).toBe(false);
  });

  it('does not hold for any other failure', () => {
    expect(refusedByEngine([failed('retries_exhausted')])).toBe(false);
    expect(refusedByEngine([])).toBe(false);
  });
});
