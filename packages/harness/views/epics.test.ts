import { describe, expect, it } from 'vitest';
import { eventSchema, type HarnessEvent } from '@uw/contracts';
import { notReadyOf } from './epics.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const issue = { repo: 'unfoldingWord/uw-platform', number: 12, githubId: 9100000012 };

function missing(n: number, evidence: Record<string, unknown>): HarnessEvent {
  return eventSchema.parse({
    eventId: `00000000-0000-4000-8000-0000000007${String(n).padStart(2, '0')}`,
    harnessId,
    itemId: null,
    name: 'done_when_missing',
    at: `2026-10-1${n}T09:00:00.000Z`,
    actor: 'agent:builder',
    evidence,
    traceId: '00000000-0000-4000-8000-0000000000c1',
    requestId: null,
    position: n,
  });
}

describe('EI-2 the not-ready list names each issue or page once, newest first', () => {
  it('keeps the first of repeated subjects and drops what is now an item', () => {
    const page = '00000000-0000-4000-8000-000000003101';
    const events = [
      missing(5, { via: 'import', issue, pageId: null, title: 'Wire the board' }),
      missing(4, { via: 'import', issue, pageId: null, title: 'Wire the board' }),
      missing(3, { via: 'kickstart', issue: null, pageId: page, title: 'Show it' }),
    ];
    expect(notReadyOf(events, []).map((entry) => entry.title)).toEqual([
      'Wire the board',
      'Show it',
    ]);
  });
});
