import { describe, expect, it } from 'vitest';
import type { Clock } from '../ports.ts';

export function describeClockContract(adapter: string, make: () => Clock): void {
  describe(`DX-3 clock port contract on ${adapter}`, () => {
    it('reads a valid instant', () => {
      expect(Number.isNaN(make().now().getTime())).toBe(false);
    });

    it('never goes backwards between two reads', () => {
      const clock = make();
      const first = clock.now().getTime();
      expect(clock.now().getTime()).toBeGreaterThanOrEqual(first);
    });

    it('hands out a fresh Date each read, so a caller cannot move it', () => {
      const clock = make();
      const read = clock.now();
      const before = read.getTime();
      read.setTime(0);
      expect(clock.now().getTime()).toBeGreaterThanOrEqual(before);
    });
  });
}
