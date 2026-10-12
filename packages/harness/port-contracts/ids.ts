import { describe, expect, it } from 'vitest';
import type { Ids } from '../ports.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function describeIdsContract(adapter: string, make: () => Ids): void {
  describe(`DX-3 ids port contract on ${adapter}`, () => {
    it('issues UUIDs', () => {
      expect(make().next()).toMatch(uuid);
    });

    it('never issues the same id twice', () => {
      const ids = make();
      const issued = Array.from({ length: 1000 }, () => ids.next());
      expect(new Set(issued).size).toBe(1000);
    });
  });
}
