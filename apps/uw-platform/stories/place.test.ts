import { describe, expect, it } from 'vitest';
import { locationAt } from './place.ts';

const where = { country: 'XA', region: 'XA-01', place: 'The well by the market in Region One' };

describe('ADR 0041 a story is placed outside the platform only as precisely as its consent allows', () => {
  it('ADR 0041 keeps the country and region at region precision and never the place', () => {
    expect(locationAt(where, 'region')).toEqual({ country: 'XA', region: 'XA-01', place: null });
  });

  it('ADR 0041 keeps only the country at country precision', () => {
    expect(locationAt(where, 'country')).toEqual({ country: 'XA', region: null, place: null });
  });

  it('ADR 0041 keeps nothing at no precision or with no consent', () => {
    const nowhere = { country: null, region: null, place: null };
    expect(locationAt(where, 'none')).toEqual(nowhere);
    expect(locationAt(where, null)).toEqual(nowhere);
  });
});
