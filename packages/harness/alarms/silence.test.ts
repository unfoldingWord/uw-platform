import { itemStateSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { SILENCE_AMBER_MS, SILENCE_RED_MS, silenceLevel } from './silence.ts';

const at = new Date('2026-10-15T12:00:00.000Z');
const minute = 60_000;
const item = itemStateSchema.parse({
  itemId: '00000000-0000-4000-8000-0000000000b1',
  harnessId: '00000000-0000-4000-8000-0000000000a1',
  stageKey: 'check',
  title: 'Wait for a review',
  pageId: null,
  priority: 0,
  due: null,
  holder: null,
  claimantKind: null,
  delegationId: null,
  leaseExpiresAt: null,
  gateStatus: 'working',
  gateTarget: null,
  branchState: 'none',
  expectedHead: null,
  riskTier: null,
  riskDomains: [],
  pullRequest: null,
  issue: null,
  zulipTopic: null,
});

function waited(ms: number) {
  return [{ item, enteredAt: new Date(at.getTime() - ms) }];
}

function stepAgo(minutes: number): Date {
  return new Date(at.getTime() - minutes * minute);
}

describe('OB-1 the silence alarm level', () => {
  it('OB-1 is ok with nothing waiting, amber from 45 minutes and red from 90 with no review step', () => {
    expect(silenceLevel([], null, at)).toBe('ok');
    expect(silenceLevel(waited(44 * minute), null, at)).toBe('ok');
    expect(silenceLevel(waited(45 * minute), null, at)).toBe('amber');
    expect(silenceLevel(waited(89 * minute), null, at)).toBe('amber');
    expect(silenceLevel(waited(90 * minute), null, at)).toBe('red');
  });

  it('OB-1 the constants are the PRD thresholds', () => {
    expect([SILENCE_AMBER_MS, SILENCE_RED_MS]).toEqual([45 * minute, 90 * minute]);
  });

  it('OB-1 a review step in the last 90 minutes keeps a long wait amber, one 90 minutes ago does not', () => {
    expect(silenceLevel(waited(90 * minute), stepAgo(89), at)).toBe('amber');
    expect(silenceLevel(waited(90 * minute), stepAgo(90), at)).toBe('red');
  });

  it('OB-1 a review step in the last 45 minutes keeps it ok', () => {
    expect(silenceLevel(waited(91 * minute), stepAgo(10), at)).toBe('ok');
    expect(silenceLevel(waited(91 * minute), stepAgo(44), at)).toBe('ok');
    expect(silenceLevel(waited(91 * minute), stepAgo(45), at)).toBe('amber');
  });
});
