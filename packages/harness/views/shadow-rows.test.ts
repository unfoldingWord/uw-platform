import { eventSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { itemOf, uid } from '../port-contracts/store-gateway-fixtures.ts';
import type { PullRequestFacts, ReviewFact } from '../ports.ts';
import { comparisonRows } from './shadow-rows.ts';

const head = 'a'.repeat(40);
const pullRequest = { repo: 'unfoldingWord/uw-platform', number: 42 };
const item = itemOf(0x7400, 1, { pullRequest, expectedHead: head });

const verdict = eventSchema.parse({
  eventId: uid(0x7480),
  harnessId: item.harnessId,
  itemId: item.itemId,
  name: 'shadow_verdict',
  at: '2026-10-15T09:00:00.000Z',
  actor: 'human:00000000-0000-4000-8000-000000000001',
  evidence: { head, verdict: 'advance', reasons: [] },
  traceId: uid(0x7481),
  position: 1,
});

function outside(reviewId: number, state: ReviewFact['state'], minute: number): ReviewFact {
  return {
    reviewId,
    reviewer: 'uwreview[bot]',
    commit: head,
    state,
    provider: null,
    findings: [],
    submittedAt: new Date(`2026-10-15T09:0${String(minute)}:00.000Z`),
  };
}

function factsWith(reviews: readonly ReviewFact[]): PullRequestFacts {
  return {
    ref: pullRequest,
    state: 'open',
    draft: false,
    head,
    headRef: `harness/${item.itemId}`,
    headRepo: pullRequest.repo,
    base: '0'.repeat(40),
    baseRef: 'main',
    defaultBranch: 'main',
    checks: [],
    reviews: [...reviews],
    files: null,
    declaration: null,
    closes: [],
    comparison: null,
    freshAt: new Date('2026-10-15T09:10:00.000Z'),
  };
}

describe('GL-3 the shadow comparison reads the latest outside review as the gate does', () => {
  it('GL-3 takes the later submitted review even when an earlier one has the higher id', () => {
    const reviews = [
      outside(9100000002, 'approved', 1),
      outside(9100000001, 'changes_requested', 5),
    ];
    const facts = new Map([[item.itemId, factsWith(reviews)]]);
    const [row] = comparisonRows({ events: [verdict], items: [item], facts });
    expect(row?.github).toEqual([{ reviewer: 'uwreview[bot]', state: 'changes_requested' }]);
  });
});
