import { newEventSchema, type EventName, type NewHarnessEvent } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { replay } from './fold.ts';

const start = Date.parse('2026-10-01T09:00:00.000Z');
const head = 'a'.repeat(40);

function event(n: number, name: EventName, evidence: Record<string, unknown>): NewHarnessEvent {
  return newEventSchema.parse({
    eventId: `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
    harnessId: '00000000-0000-4000-8000-0000000000a1',
    itemId: '00000000-0000-4000-8000-0000000000b1',
    name,
    at: new Date(start + n * 1000).toISOString(),
    actor: 'human:00000000-0000-4000-8000-000000000001',
    evidence,
    traceId: '00000000-0000-4000-8000-0000000000e1',
  });
}

function abandonedAt(expectedHead: string): readonly NewHarnessEvent[] {
  return [
    event(1, 'item_created', {
      stage: 'build',
      title: 'Item',
      pageId: null,
      priority: 0,
      due: null,
    }),
    event(2, 'submitted_to_gate', {
      stage: 'build',
      result: 'checks_failed',
      to: null,
      expectedHead,
      pullRequest: null,
      evidence: {},
    }),
    event(3, 'branch_abandoned', { head: expectedHead }),
  ];
}

describe('KN-4 replay folds branch adoption into the expected head', () => {
  it('takes the adopted tip as the expected head', () => {
    const tip = 'c'.repeat(40);
    const adopted = event(4, 'branch_adopted', { head: tip });
    expect(replay([...abandonedAt(head), adopted])).toMatchObject({
      branchState: 'active',
      expectedHead: tip,
    });
  });

  it('keeps the expected head when the adoption records no head', () => {
    const adopted = event(4, 'branch_adopted', { head: null });
    expect(replay([...abandonedAt(head), adopted])).toMatchObject({
      branchState: 'active',
      expectedHead: head,
    });
  });
});
