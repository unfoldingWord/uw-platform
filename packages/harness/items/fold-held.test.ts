import { newEventSchema, type NewHarnessEvent } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { foldItem, replay } from './fold.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000b1';
const person = 'human:00000000-0000-4000-8000-000000000001';
let count = 0;

function event(name: string, at: string, evidence: Record<string, unknown>): NewHarnessEvent {
  count += 1;
  return newEventSchema.parse({
    eventId: `00000000-0000-4000-8000-${String(count).padStart(12, '0')}`,
    harnessId,
    itemId,
    name,
    at,
    actor: person,
    evidence,
    traceId: '00000000-0000-4000-8000-0000000000c1',
    requestId: null,
  });
}

const claim = { holder: person, claimantKind: 'person', delegationId: null, leaseExpiresAt: null };
const created = event('item_created', '2026-10-15T08:00:00.000Z', {
  stage: 'package',
  title: 'Hold the ball',
  pageId: null,
  priority: 0,
  due: null,
});
const claimed = event('item_claimed', '2026-10-15T09:00:00.000Z', claim);

describe('OB-2 an item knows when its holder took the ball', () => {
  it('OB-2 starts at creation and moves on a claim', () => {
    expect(replay([created])?.heldSince).toBe('2026-10-15T08:00:00.000Z');
    expect(replay([created, claimed])?.heldSince).toBe('2026-10-15T09:00:00.000Z');
  });

  it('OB-2 does not move on a lease renewal or a reorder', () => {
    const renewed = event('lease_renewed', '2026-10-15T10:00:00.000Z', {
      leaseExpiresAt: '2026-10-15T10:15:00.000Z',
    });
    const reordered = event('item_reordered', '2026-10-15T10:30:00.000Z', {
      priority: 4,
      before: null,
    });
    expect(replay([created, claimed, renewed, reordered])?.heldSince).toBe(
      '2026-10-15T09:00:00.000Z',
    );
  });

  it('OB-2 moves on a release and on a stage change', () => {
    const released = event('item_released', '2026-10-15T11:00:00.000Z', { holder: person });
    const advanced = event('stage_advanced', '2026-10-15T12:00:00.000Z', {
      from: 'package',
      to: 'scope',
    });
    expect(replay([created, claimed, released])?.heldSince).toBe('2026-10-15T11:00:00.000Z');
    expect(replay([created, claimed, released, advanced])?.heldSince).toBe(
      '2026-10-15T12:00:00.000Z',
    );
  });

  it('OB-2 moves on a claim folded onto a row the claim write already updated', () => {
    const live = replay([created, claimed]);
    if (live === null) throw new Error('the item did not fold');
    const again = event('item_claimed', '2026-10-15T13:00:00.000Z', claim);
    expect(foldItem(live, again).heldSince).toBe('2026-10-15T13:00:00.000Z');
  });
});
