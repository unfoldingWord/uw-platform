import { newEventSchema, type EventName, type NewHarnessEvent } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { foldItem, replay, steppedNames } from './fold.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000b1';
const start = Date.parse('2026-10-03T09:00:00.000Z');

function event(n: number, name: EventName, evidence: Record<string, unknown>): NewHarnessEvent {
  return newEventSchema.parse({
    eventId: `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
    harnessId,
    itemId,
    name,
    at: new Date(start + n * 1000).toISOString(),
    actor: 'agent:system',
    evidence,
    traceId: '00000000-0000-4000-8000-0000000000e1',
    requestId: null,
  });
}

const created = event(1, 'item_created', {
  stage: 'ship',
  title: 'Item',
  pageId: null,
  priority: 0,
  due: null,
});
const linked = event(2, 'zulip_topic_linked', { topic: 'software/item-00000000' });

describe('the Zulip topic folds from its event', () => {
  it('sets the topic on the item', () => {
    expect(replay([created, linked])?.zulipTopic).toBe('software/item-00000000');
  });

  it('starts with no topic and changes nothing else', () => {
    const before = foldItem(null, created);
    expect(before.zulipTopic).toBeNull();
    expect(foldItem(before, linked)).toEqual({ ...before, zulipTopic: 'software/item-00000000' });
  });

  it('is a fold step, not an unchanged event', () => {
    expect(steppedNames).toContain('zulip_topic_linked');
  });
});
