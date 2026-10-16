import type { ReviewFinding, ReviewRecord } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { countsAsRound, postedVerdict, weighedFindings } from './weights.ts';

const real: ReviewFinding = { text: 'The lease is never renewed.', weight: 'real' };
const plausible: ReviewFinding = { text: 'The empty state may be dropped.', weight: 'plausible' };
const theoretical: ReviewFinding = {
  text: 'A clock skew of a year would break this.',
  weight: 'theoretical',
};

function record(
  verdict: ReviewRecord['verdict'],
  findings: readonly ReviewFinding[],
): ReviewRecord {
  return {
    reviewer: 'uw-reviewer',
    provider: 'deepinfra',
    model: 'z-ai/glm-5.3',
    verdict,
    reviewId: 9300000001,
    findings: [...findings],
  };
}

describe('RV-1 every finding carries a weight', () => {
  it('keeps weighted findings, trimmed and bounded', () => {
    const padded = { text: '  The lease is never renewed. ', weight: 'real' as const };
    expect(weighedFindings([padded])).toEqual([real]);
    expect(weighedFindings(Array.from({ length: 60 }, () => real))).toHaveLength(50);
  });

  it('refuses the verdict when any finding has no weight', () => {
    expect(weighedFindings([real, { text: 'No weight here.', weight: null }])).toBeNull();
  });

  it('posts approve for no findings, whatever the model said', () => {
    expect(postedVerdict('no_real_or_plausible', 'request_changes', [])).toBe('approve');
  });

  it('counts a review round only for request_changes with a real or plausible finding', () => {
    expect(countsAsRound(record('request_changes', [real]))).toBe(true);
    expect(countsAsRound(record('request_changes', [plausible, theoretical]))).toBe(true);
    expect(countsAsRound(record('request_changes', [theoretical]))).toBe(false);
    expect(countsAsRound(record('request_changes', []))).toBe(false);
    expect(countsAsRound(record('approve', [real]))).toBe(false);
  });
});

describe('RV-3 the strictness preset decides what blocks', () => {
  it('no_real_or_plausible requests changes on a real or plausible finding and keeps the model verdict otherwise', () => {
    expect(postedVerdict('no_real_or_plausible', 'approve', [plausible])).toBe('request_changes');
    expect(postedVerdict('no_real_or_plausible', 'approve', [theoretical])).toBe('approve');
    expect(postedVerdict('no_real_or_plausible', 'request_changes', [theoretical])).toBe(
      'request_changes',
    );
  });

  it('zero_findings requests changes on any finding at all', () => {
    expect(postedVerdict('zero_findings', 'approve', [theoretical])).toBe('request_changes');
  });
});
