import { describe, expect, it } from 'vitest';
import { identitySchema, type HarnessEvent } from '@uw/contracts';
import {
  burndown,
  cumulativeFlow,
  cycleTimes,
  foldHistories,
  HISTORY_FOLD_LIMIT,
  HISTORY_READ_LIMIT,
  historyWindow,
} from './item-history.ts';

const harnessId = '00000000-0000-4000-8000-0000000019b1';
const [one, two, three, orphan] = [
  '00000000-0000-4000-8000-0000000019c1',
  '00000000-0000-4000-8000-0000000019c2',
  '00000000-0000-4000-8000-0000000019c3',
  '00000000-0000-4000-8000-0000000019c4',
];
const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];

let position = 0;

function event(name: HarnessEvent['name'], itemId: string, at: string, evidence: object) {
  position += 1;
  const shaped: HarnessEvent = {
    eventId: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
    harnessId,
    itemId,
    name,
    at,
    actor: identitySchema.parse('agent:builder'),
    evidence: { ...evidence },
    traceId: '00000000-0000-4000-8000-0000000019ff',
    requestId: null,
    position,
  };
  return shaped;
}

const created = (itemId: string, at: string) =>
  event('item_created', itemId, at, { stage: 'plan', title: 'An item' });
const moved = (itemId: string, at: string, from: string, to: string | null) =>
  event('stage_advanced', itemId, at, { from, to });
const looped = (itemId: string, at: string, from: string, to: string) =>
  event('loop_edge_taken', itemId, at, { from, to });

const events: readonly HarnessEvent[] = [
  created(one, '2026-11-01T09:00:00.000Z'),
  moved(one, '2026-11-02T09:00:00.000Z', 'plan', 'build'),
  moved(one, '2026-11-03T09:00:00.000Z', 'build', null),
  created(two, '2026-11-02T10:00:00.000Z'),
  moved(two, '2026-11-02T12:00:00.000Z', 'plan', 'build'),
  looped(two, '2026-11-03T12:00:00.000Z', 'build', 'plan'),
  created(three, '2026-11-03T08:00:00.000Z'),
  moved(three, '2026-11-04T08:00:00.000Z', 'plan', 'build'),
  moved(three, '2026-11-04T20:00:00.000Z', 'build', null),
  moved(orphan, '2026-11-02T09:00:00.000Z', 'plan', 'build'),
];

const newestFirst = [...events].reverse();

describe('#199 item history is a fold over item_created, stage_advanced and loop_edge_taken', () => {
  it('#199 folds each item into its steps, oldest first, whatever order the events came in', () => {
    const folded = foldHistories(newestFirst);
    const first = folded.items.find((item) => item.itemId === one);
    expect(first?.steps.map((step) => step.stage)).toEqual(['plan', 'build', null]);
    expect(folded.items.map((item) => item.itemId).sort()).toEqual([one, two, three].sort());
  });

  it('#199 leaves out, and counts, an item whose creation was not read, never guessing its start', () => {
    expect(foldHistories(newestFirst).unread).toBe(1);
  });

  it('#199 cumulative flow counts the items in each stage, then done, at the end of each day', () => {
    const folded = foldHistories(newestFirst);
    const flow = cumulativeFlow({ stages: ['plan', 'build'], items: folded.items }, days);
    const on = (day: string) =>
      flow.filter((row) => row.day === day).map((row) => [row.stage, row.items]);
    expect(on('2026-11-01')).toEqual([
      ['plan', 1],
      ['build', 0],
      [null, 0],
    ]);
    expect(on('2026-11-02')).toEqual([
      ['plan', 0],
      ['build', 2],
      [null, 0],
    ]);
    expect(on('2026-11-03')).toEqual([
      ['plan', 2],
      ['build', 0],
      [null, 1],
    ]);
    expect(on('2026-11-04')).toEqual([
      ['plan', 1],
      ['build', 0],
      [null, 2],
    ]);
  });
});

describe('#199 the history folds into cumulative flow, cycle time and burndown', () => {
  it('#199 cumulative flow keeps a stage the items passed through even when the workflow no longer has it', () => {
    const flow = cumulativeFlow({ stages: ['plan'], items: foldHistories(events).items }, days);
    expect([...new Set(flow.map((row) => row.stage))]).toEqual(['plan', 'build', null]);
  });

  it('#199 cycle time is the median days from creation to done, per day finished, and empty on days nothing finished', () => {
    const cycles = cycleTimes(foldHistories(events).items, days);
    expect(cycles).toEqual([
      { day: '2026-11-01', finished: 0, medianDays: null },
      { day: '2026-11-02', finished: 0, medianDays: null },
      { day: '2026-11-03', finished: 1, medianDays: 2 },
      { day: '2026-11-04', finished: 1, medianDays: 1.5 },
    ]);
  });

  it('#199 burndown counts the items open at the end of each day', () => {
    expect(burndown(foldHistories(events).items, days)).toEqual([
      { day: '2026-11-01', open: 1 },
      { day: '2026-11-02', open: 2 },
      { day: '2026-11-03', open: 2 },
      { day: '2026-11-04', open: 1 },
    ]);
  });
});

function creations(count: number): readonly HarnessEvent[] {
  const start = Date.parse('2026-10-01T00:00:00.000Z');
  return Array.from({ length: count }, (_, index) =>
    created(
      `00000000-0000-4000-9000-${String(index).padStart(12, '0')}`,
      new Date(start + index * 60_000).toISOString(),
    ),
  ).reverse();
}

describe('#199 the history read tells a truncated read from an exactly full one', () => {
  it('#199 reads one event more than it folds', () => {
    expect(HISTORY_READ_LIMIT).toBe(HISTORY_FOLD_LIMIT + 1);
  });

  it('#199 a read holding no more events than it folds is not capped, and folds them all', () => {
    const read = creations(HISTORY_FOLD_LIMIT);
    const window = historyWindow(read);
    expect(window.capped).toBe(false);
    expect(window.events).toHaveLength(HISTORY_FOLD_LIMIT);
  });

  it('#199 one event beyond the fold marks the read capped, even when every item folded was created in it', () => {
    const read = creations(HISTORY_READ_LIMIT);
    const window = historyWindow(read);
    expect(window.capped).toBe(true);
    expect(window.events).toEqual(read.slice(0, HISTORY_FOLD_LIMIT));
    expect(foldHistories(window.events).unread).toBe(0);
  });
});
