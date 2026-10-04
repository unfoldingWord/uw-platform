import { describe, expect, it } from 'vitest';
import { COOLDOWN_MS, POSTING_REASONS, chooseInWindow, wakeRank } from './rank.ts';

const t = new Date('2026-10-03T09:00:00.000Z');
const plus = (ms: number) => new Date(t.getTime() + ms);
const minute = 60_000;

describe('a weaker wake never spends the window a stronger one needs', () => {
  it('sends when no window is open, and opens one at that instant and rank', () => {
    expect(chooseInWindow(null, 'stage_advanced', t)).toEqual({
      decision: 'send',
      window: { startedAt: t, rank: 1 },
    });
  });

  it('sends a gate wake a minute after a stage advance', () => {
    const choice = chooseInWindow({ startedAt: t, rank: 1 }, 'gate_waiting', plus(minute));
    expect(choice).toEqual({ decision: 'send', window: { startedAt: plus(minute), rank: 3 } });
  });

  it('coalesces an equal wake until ten minutes have passed, then sends', () => {
    const window = { startedAt: t, rank: 3 };
    expect(chooseInWindow(window, 'gate_waiting', plus(COOLDOWN_MS - 1_000))).toEqual({
      decision: 'coalesce',
    });
    expect(chooseInWindow(window, 'gate_waiting', plus(COOLDOWN_MS)).decision).toBe('send');
  });

  it('coalesces a run failure inside a gate window', () => {
    expect(chooseInWindow({ startedAt: t, rank: 3 }, 'run_failed', plus(minute))).toEqual({
      decision: 'coalesce',
    });
  });

  it('sends a gate wake inside a run failure window and starts a rank 3 window then', () => {
    expect(chooseInWindow({ startedAt: t, rank: 2 }, 'gate_waiting', plus(2 * minute))).toEqual({
      decision: 'send',
      window: { startedAt: plus(2 * minute), rank: 3 },
    });
  });

  it('ranks gates, lapses and hand-offs above run failures above stage advances, and posts all but advances', () => {
    expect(wakeRank).toEqual({
      gate_waiting: 3,
      delegation_lapsed: 3,
      run_failed: 2,
      stage_advanced: 1,
      handed_to_person: 3,
    });
    expect([...POSTING_REASONS].sort()).toEqual([
      'delegation_lapsed',
      'gate_waiting',
      'handed_to_person',
      'run_failed',
    ]);
  });
});
