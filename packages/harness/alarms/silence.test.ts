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

describe('OB-1 the silence alarm level', () => {
  it('OB-1 is ok with nothing waiting, amber at 45 minutes and red at 90 with no review step', () => {
    expect(silenceLevel([], null, at)).toBe('ok');
    expect(silenceLevel(waited(SILENCE_AMBER_MS - minute), null, at)).toBe('ok');
    expect(silenceLevel(waited(SILENCE_AMBER_MS), null, at)).toBe('amber');
    expect(silenceLevel(waited(SILENCE_RED_MS), null, at)).toBe('red');
  });

  it('OB-1 a review step in the window keeps it from going red, or from amber when recent', () => {
    const tenAgo = new Date(at.getTime() - 10 * minute);
    const sixtyAgo = new Date(at.getTime() - 60 * minute);
    expect(silenceLevel(waited(SILENCE_RED_MS + minute), tenAgo, at)).toBe('ok');
    expect(silenceLevel(waited(SILENCE_RED_MS + minute), sixtyAgo, at)).toBe('amber');
  });
});
