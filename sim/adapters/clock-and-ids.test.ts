import { describe, expect, it } from 'vitest';
import { createSimClock } from './clock.ts';
import { createSimIds } from './ids.ts';

const start = new Date('2026-10-01T09:00:00.000Z');

describe('DX-4 the sim clock', () => {
  it('reads the instant it was started at', () => {
    expect(createSimClock(start).now().toISOString()).toBe('2026-10-01T09:00:00.000Z');
  });

  it('advances by milliseconds', () => {
    const clock = createSimClock(start);
    clock.advance(900000);
    expect(clock.now().toISOString()).toBe('2026-10-01T09:15:00.000Z');
  });

  it('sets to a later instant', () => {
    const clock = createSimClock(start);
    clock.set(new Date('2026-10-02T00:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('never goes backwards', () => {
    const clock = createSimClock(start);
    expect(() => clock.set(new Date('2026-10-01T08:59:59.999Z'))).toThrow(
      new RangeError('the sim clock never goes backwards'),
    );
  });

  it.each([-1, Number.NaN])('refuses to advance by %s', (milliseconds) => {
    const clock = createSimClock(start);
    expect(() => clock.advance(milliseconds)).toThrow(
      new RangeError('advance by a non-negative number of milliseconds'),
    );
  });
});

describe('DX-4 the sim ids', () => {
  it('issue sequential UUIDs from one', () => {
    const ids = createSimIds();
    expect([ids.next(), ids.next()]).toEqual([
      '00000000-0000-4000-a000-000000000001',
      '00000000-0000-4000-a000-000000000002',
    ]);
  });

  it('start again at one for a second source', () => {
    createSimIds().next();
    expect(createSimIds().next()).toBe('00000000-0000-4000-a000-000000000001');
  });

  it('count what they issued', () => {
    const ids = createSimIds();
    ids.next();
    ids.next();
    ids.next();
    expect(ids.issued()).toBe(3);
  });
});
