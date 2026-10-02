import { describe, expect, it } from 'vitest';
import { eventSchema, type HarnessEvent } from '@uw/contracts';
import { formatResult } from './report.ts';

function event(name: HarnessEvent['name'], at: string): HarnessEvent {
  return eventSchema.parse({
    eventId: 'c2000000-0000-4000-8000-000000000001',
    harnessId: 'c2000000-0000-4000-8000-000000000002',
    name,
    at,
    actor: 'human:c2000000-0000-4000-8000-000000000003',
    payload: { stage: 'ship' },
  });
}

const passing = {
  name: 'ZZ-1.fixture',
  title: 'a fixture',
  report: {
    events: [
      event('lease_expired', '2026-10-01T09:15:00.000Z'),
      event('gate_approved', '2026-10-01T09:20:00.000Z'),
    ],
    state: { stage: 'ship', holder: null },
  },
  failure: null,
};

const passingText = [
  'scenario ZZ-1.fixture: a fixture',
  'events (2):',
  '  1. 2026-10-01T09:15:00.000Z lease_expired human:c2000000-0000-4000-8000-000000000003 {"stage":"ship"}',
  '  2. 2026-10-01T09:20:00.000Z gate_approved human:c2000000-0000-4000-8000-000000000003 {"stage":"ship"}',
  'state:',
  '  {',
  '    "stage": "ship",',
  '    "holder": null',
  '  }',
  'result: pass',
].join('\n');

describe('DX-4 the sim prints the event log and the folded state', () => {
  it('prints each event on its own line, then the folded state, then the result', () => {
    expect(formatResult(passing)).toBe(passingText);
  });

  it('prints an empty event log as a count of zero and no event lines', () => {
    const text = formatResult({ ...passing, report: { events: [], state: {} } });
    expect(text).toBe(
      ['scenario ZZ-1.fixture: a fixture', 'events (0):', 'state:', '  {}', 'result: pass'].join(
        '\n',
      ),
    );
  });

  it('prints a failed scenario as its name and the failure, and nothing else', () => {
    const failed = {
      name: 'ZZ-2.fixture',
      title: 'broken',
      report: null,
      failure: 'expected 1 to equal 2',
    };
    expect(formatResult(failed)).toBe(
      'scenario ZZ-2.fixture: broken\nresult: fail: expected 1 to equal 2',
    );
  });

  it('prints an instant in the state as its whole ISO string', () => {
    const at = new Date('2026-10-01T09:15:00.000Z');
    const text = formatResult({ ...passing, report: { events: [], state: { now: at } } });
    expect(text).toContain('"now": "2026-10-01T09:15:00.000Z"');
  });
});
