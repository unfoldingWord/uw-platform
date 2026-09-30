import { describe, expect, it } from 'vitest';
import { formatDate } from '@uw/core/dates';

describe('uw-ingest wiring', () => {
  it('resolves the one date formatter', () => {
    expect(formatDate(new Date(Date.UTC(2026, 8, 29)))).toBe('2026-09-29');
  });
});
