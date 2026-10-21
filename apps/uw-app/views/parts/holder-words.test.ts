import { identitySchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { holderText } from './holder-words.ts';

const at = new Date('2026-10-16T09:30:00.000Z');
const since = new Date('2026-10-15T08:00:00.000Z');

describe('OB-2 the holder in words', () => {
  it('OB-2 names the claimant and how long they have held it', () => {
    const holder = {
      role: 'claimant' as const,
      kind: 'person' as const,
      identity: identitySchema.parse('human:ian'),
      since,
    };
    expect(holderText(holder, at)).toBe('Claimed by human:ian, for 1 d 1 h');
  });

  it('OB-2 names the Reviewer, a waiting decision, nobody, and an unknown start', () => {
    const reviewer = {
      role: 'reviewer' as const,
      kind: 'agent' as const,
      identity: identitySchema.parse('agent:reviewer'),
      since,
    };
    const decider = {
      role: 'decider' as const,
      kind: 'person' as const,
      identity: null,
      since: null,
    };
    expect(holderText(reviewer, at)).toBe('Under review by agent:reviewer, for 1 d 1 h');
    expect(holderText(decider, at)).toBe('Waiting on a person to decide');
    expect(holderText(null, at)).toBe('Nobody');
  });
});
