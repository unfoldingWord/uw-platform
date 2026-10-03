import { newEventSchema, type EventName, type NewHarnessEvent } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { replay } from './fold.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000b1';
const start = Date.parse('2026-10-01T09:00:00.000Z');
const issue = { repo: 'unfoldingWord/uw-platform', number: 42, githubId: 9100000001 };

function event(n: number, name: EventName, evidence: Record<string, unknown>): NewHarnessEvent {
  return newEventSchema.parse({
    eventId: `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
    harnessId,
    itemId,
    name,
    at: new Date(start + n * 1000).toISOString(),
    actor: 'agent:ingest',
    evidence,
    traceId: '00000000-0000-4000-8000-0000000000e1',
    requestId: null,
  });
}

function created(wrapped: typeof issue | null): NewHarnessEvent {
  return event(1, 'item_created', {
    stage: 'package',
    title: 'Wire the board',
    pageId: null,
    priority: 0,
    due: null,
    issue: wrapped,
  });
}

function labelRemoved(): NewHarnessEvent {
  return event(2, 'label_removed', {
    issue,
    label: 'harness',
    githubUpdatedAt: '2026-10-01T09:30:00.000Z',
  });
}

describe('GH-3 an item remembers the issue it wraps', () => {
  it('folds the issue of item_created onto the item', () => {
    expect(replay([created(issue)])?.issue).toEqual(issue);
  });

  it('folds an item_created with no issue to an item with none', () => {
    expect(replay([created(null)])?.issue).toBeNull();
  });

  it('leaves the item, its issue included, unchanged when the label is removed', () => {
    expect(replay([created(issue), labelRemoved()])).toEqual(replay([created(issue)]));
  });
});
