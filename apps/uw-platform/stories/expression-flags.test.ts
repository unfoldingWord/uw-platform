import { describe, expect, it } from 'vitest';
import type { ConsentHistory } from './consent-interval.ts';
import { flagCounts, flagsOf } from './expression-flags.ts';

const granted = { kind: 'granted', startsOn: '2026-10-01', endsBefore: null } as const;
const consent: ConsentHistory = [granted];

function release(startsOn: string, endsBefore: string | null): ConsentHistory {
  return [{ kind: 'granted', startsOn, endsBefore }];
}

function withdrawnOn(day: string): ConsentHistory {
  return [granted, { kind: 'withdrawn', startsOn: day }];
}

describe('ADR 0041 a telling above its level or without consent is flagged', () => {
  it('ADR 0041 flags a public post of a newsletter story as told above its level', () => {
    const told = { channel: 'public', publishedOn: '2026-10-05' } as const;
    expect(flagsOf(told, 'newsletter', consent)).toEqual(['told_above_level']);
    expect(flagsOf({ ...told, channel: 'newsletter' }, 'newsletter', consent)).toEqual([]);
  });

  it('ADR 0041 flags a telling planned above its level before it is told', () => {
    expect(flagsOf({ channel: 'public', publishedOn: null }, 'internal', [])).toEqual([
      'told_above_level',
    ]);
  });

  it('ADR 0041 flags a telling published with no consent, before it, on or after its expiry or once it was withdrawn', () => {
    const told = { channel: 'newsletter', publishedOn: '2026-11-02' } as const;
    const unconsented = ['told_without_consent'];
    expect(flagsOf(told, 'public', [])).toEqual(unconsented);
    expect(flagsOf(told, 'public', release('2026-11-03', null))).toEqual(unconsented);
    expect(flagsOf(told, 'public', release('2026-10-01', '2026-11-01'))).toEqual(unconsented);
    expect(flagsOf(told, 'public', release('2026-10-01', '2026-11-02'))).toEqual(unconsented);
    expect(flagsOf(told, 'public', withdrawnOn('2026-11-02'))).toEqual(unconsented);
    expect(flagsOf(told, 'public', withdrawnOn('2026-11-03'))).toEqual([]);
    expect(flagsOf(told, 'public', release('2026-10-01', '2026-11-03'))).toEqual([]);
    expect(flagsOf(told, 'public', release('2026-11-02', null))).toEqual([]);
  });

  it('ADR 0041 judges each telling by the release in effect on its day: an original, a gap, a renewal', () => {
    const history: ConsentHistory = [
      { kind: 'granted', startsOn: '2026-01-01', endsBefore: '2026-06-01' },
      { kind: 'withdrawn', startsOn: '2026-05-01' },
      { kind: 'granted', startsOn: '2026-07-01', endsBefore: null },
    ];
    const on = (publishedOn: string) =>
      flagsOf({ channel: 'public', publishedOn }, 'public', history);
    expect(on('2026-03-01')).toEqual([]);
    expect(on('2026-05-01')).toEqual(['told_without_consent']);
    expect(on('2026-06-15')).toEqual(['told_without_consent']);
    expect(on('2026-08-01')).toEqual([]);
  });

  it('ADR 0041 asks no consent of a telling kept on the platform or not told yet', () => {
    expect(flagsOf({ channel: 'platform', publishedOn: '2026-11-02' }, 'internal', [])).toEqual([]);
    expect(flagsOf({ channel: 'newsletter', publishedOn: null }, 'newsletter', [])).toEqual([]);
  });

  it('ADR 0041 counts the flags of every expression not retired', () => {
    const counted = flagCounts([
      { status: 'confirmed', flags: ['told_above_level', 'told_without_consent'] },
      { status: 'suggested', flags: ['told_above_level'] },
      { status: 'retired', flags: ['told_above_level', 'told_without_consent'] },
    ]);
    expect(counted).toEqual({ toldAboveLevel: 2, toldWithoutConsent: 1 });
  });
});
