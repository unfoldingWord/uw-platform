import { identitySchema, type EventName, type HarnessEvent, type ItemState } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { foldItem } from '../items/fold.ts';
import { decisionInFlight, parkingChangedSince, sameChange } from './parking.ts';

const actor = identitySchema.parse('human:00000000-0000-4000-8000-000000000001');
const decision = '00000000-0000-4000-8000-0000000000d1';

function event(name: EventName, evidence: HarnessEvent['evidence'] = {}): HarnessEvent {
  return {
    eventId: '00000000-0000-4000-8000-0000000000e1',
    harnessId: '00000000-0000-4000-8000-0000000000a1',
    itemId: '00000000-0000-4000-8000-0000000000b1',
    name,
    position: 1,
    at: '2026-10-02T09:00:00.000Z',
    actor,
    evidence,
    traceId: '00000000-0000-4000-8000-0000000000c1',
  };
}

const parked = event('submitted_to_gate', { result: 'parked' });
const advanced = event('submitted_to_gate', { result: 'advanced' });
const approved = event('gate_approved', { decisionId: decision });
const overridden = event('gate_overridden', { decisionId: decision });
const merged = event('connector_succeeded');
const refusedMerge = event('connector_refused');

describe('decisionInFlight', () => {
  it.each([
    ['nothing parked or approved', [], false],
    ['a parking with no decision', [parked], false],
    ['an approval with no connector result', [parked, approved], true],
    ['an override with no connector result', [parked, overridden], true],
    ['an approval the connector merged', [parked, approved, merged], false],
    ['an approval the connector refused', [parked, approved, refusedMerge], false],
    ['an approval followed by a fresh parking', [parked, approved, merged, parked], false],
    [
      'an earlier answered approval and a new one',
      [parked, approved, refusedMerge, approved],
      true,
    ],
    ['an advanced submit is not a parking', [parked, approved, advanced], true],
  ])('%s', (_title, events, expected) => {
    expect(decisionInFlight(events)).toBe(expected);
  });
});

describe('parkingChangedSince', () => {
  it.each([
    ['a decision that is not in the log', [parked], true],
    ['the approval and nothing after it', [parked, approved], false],
    ['only the connector result after it', [parked, approved, merged], false],
    ['a rejection after it', [parked, approved, event('gate_rejected')], true],
    ['a take over after it', [parked, approved, event('gate_taken_over')], true],
    ['a second approval after it', [parked, approved, overridden], true],
    ['a new submit after it', [parked, approved, parked], true],
  ])('%s', (_title, events, expected) => {
    expect(parkingChangedSince(events, decision)).toBe(expected);
  });
});

const created = foldItem(
  null,
  event('item_created', { stage: 'ship', title: 'Item', pageId: null, priority: 1, due: null }),
);

function withChange(change: Pick<Partial<ItemState>, 'pullRequest' | 'expectedHead'>): ItemState {
  return { ...created, ...change };
}

describe('sameChange', () => {
  const pr = { repo: 'unfoldingWord/uw-platform', number: 42 };

  it.each([
    ['no pull request and no head on both', {}, {}, true],
    [
      'the same pull request and head',
      { pullRequest: pr, expectedHead: 'a' },
      { pullRequest: { ...pr }, expectedHead: 'a' },
      true,
    ],
    [
      'another head',
      { pullRequest: pr, expectedHead: 'a' },
      { pullRequest: pr, expectedHead: 'b' },
      false,
    ],
    [
      'another pull request number',
      { pullRequest: pr },
      { pullRequest: { ...pr, number: 43 } },
      false,
    ],
    [
      'another repository',
      { pullRequest: pr },
      { pullRequest: { ...pr, repo: 'other/repo' } },
      false,
    ],
    ['a pull request on one side only', { pullRequest: pr }, {}, false],
  ])('%s', (_title, before, after, expected) => {
    expect(sameChange(withChange(before), withChange(after))).toBe(expected);
  });
});
