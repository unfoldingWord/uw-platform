import { describe, expect, it } from 'vitest';
import { flagCounts, flagsOf, type ConsentFacts } from './expression-flags.ts';

const consent: ConsentFacts = { consentedOn: '2026-10-01', expires: null, withdrawnOn: null };

describe('ADR 0041 a telling above its level or without consent is flagged', () => {
  it('ADR 0041 flags a public post of a newsletter story as told above its level', () => {
    const told = { channel: 'public', publishedOn: '2026-10-05' } as const;
    expect(flagsOf(told, 'newsletter', consent)).toEqual(['told_above_level']);
    expect(flagsOf({ ...told, channel: 'newsletter' }, 'newsletter', consent)).toEqual([]);
  });

  it('ADR 0041 flags a telling planned above its level before it is told', () => {
    expect(flagsOf({ channel: 'public', publishedOn: null }, 'internal', null)).toEqual([
      'told_above_level',
    ]);
  });

  it('ADR 0041 flags a telling published with no consent, before it, after it expired or once it was withdrawn', () => {
    const told = { channel: 'newsletter', publishedOn: '2026-11-02' } as const;
    expect(flagsOf(told, 'public', null)).toEqual(['told_without_consent']);
    expect(flagsOf(told, 'public', { ...consent, consentedOn: '2026-11-03' })).toEqual([
      'told_without_consent',
    ]);
    expect(flagsOf(told, 'public', { ...consent, expires: '2026-11-01' })).toEqual([
      'told_without_consent',
    ]);
    expect(flagsOf(told, 'public', { ...consent, withdrawnOn: '2026-11-02' })).toEqual([
      'told_without_consent',
    ]);
    expect(flagsOf(told, 'public', { ...consent, withdrawnOn: '2026-11-03' })).toEqual([]);
    expect(flagsOf(told, 'public', { ...consent, expires: '2026-11-02' })).toEqual([]);
  });

  it('ADR 0041 asks no consent of a telling kept on the platform or not told yet', () => {
    expect(flagsOf({ channel: 'platform', publishedOn: '2026-11-02' }, 'internal', null)).toEqual(
      [],
    );
    expect(flagsOf({ channel: 'newsletter', publishedOn: null }, 'newsletter', null)).toEqual([]);
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
