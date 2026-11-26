import { describe, expect, it } from 'vitest';
import { budgetSpent, monthStart, spentMicros } from './spend.ts';

const ceiling = 50;
const known = (knownMicros: number, unknownTurns = 0, openTurns = 0) => ({
  knownMicros,
  unknownTurns,
  openTurns,
});

describe('PA-3 an assistant month is summed in micros before it meets the budget', () => {
  it('counts 4,000 turns of 4,000 micros as 16 units, which a 16-unit month has spent', () => {
    const month = known(4_000 * 4_000);
    expect(spentMicros(month, ceiling)).toBe(16_000_000);
    expect(budgetSpent(month, ceiling, 1_600)).toBe(true);
    expect(budgetSpent(month, ceiling, 1_601)).toBe(false);
  });

  it('adds a turn of unknown cost at the role ceiling, in micros', () => {
    expect(spentMicros(known(1, 2), ceiling)).toBe(1 + 2 * ceiling * 10_000);
    expect(budgetSpent(known(0, 2), ceiling, 2 * ceiling)).toBe(true);
    expect(budgetSpent(known(0, 1), ceiling, 2 * ceiling)).toBe(false);
  });

  it('reserves each admitted, unfinished turn at the role ceiling until it finishes', () => {
    expect(spentMicros(known(1, 1, 2), ceiling)).toBe(1 + 3 * ceiling * 10_000);
    expect(budgetSpent(known(0, 0, 1), ceiling, ceiling)).toBe(true);
    expect(budgetSpent(known(0, 0, 1), ceiling, ceiling + 1)).toBe(false);
  });

  it('cuts off neither early nor late at the rounding boundary', () => {
    expect(budgetSpent(known(2 * 5_000), ceiling, 2)).toBe(false);
    expect(budgetSpent(known(19_999), ceiling, 2)).toBe(false);
    expect(budgetSpent(known(20_000), ceiling, 2)).toBe(true);
    expect(budgetSpent(known(4_999 * 4_999), ceiling, 2_000)).toBe(true);
  });

  it('starts the month at midnight UTC on its first day', () => {
    expect(monthStart(new Date('2026-10-31T23:59:59.000Z')).toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(monthStart(new Date('2026-11-01T00:00:00.000Z')).toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
  });
});
