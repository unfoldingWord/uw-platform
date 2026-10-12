import type { Clock } from '@uw/harness';

export type SimClock = Clock & { set(at: Date): void; advance(milliseconds: number): void };

export function createSimClock(start: Date): SimClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    set: (at) => {
      if (at.getTime() < current) throw new RangeError('the sim clock never goes backwards');
      current = at.getTime();
    },
    advance: (milliseconds) => {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) {
        throw new RangeError('advance by a non-negative number of milliseconds');
      }
      current += milliseconds;
    },
  };
}
