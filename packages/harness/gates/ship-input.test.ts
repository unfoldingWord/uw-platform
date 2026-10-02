import { principalSchema, type ItemState } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { PullRequestFacts } from '../ports.ts';
import { assembleShipInput } from './ship-input.ts';

const at = new Date('2026-10-01T09:00:00.000Z');
const ref = { repo: 'unfoldingWord/uw-platform', number: 42 };

const item: ItemState = {
  itemId: '00000000-0000-4000-8000-000000000301',
  harnessId: '00000000-0000-4000-8000-000000000302',
  stageKey: 'ship',
  title: 'Show the board',
  pageId: null,
  priority: 1,
  due: null,
  holder: null,
  claimantKind: null,
  delegationId: null,
  leaseExpiresAt: null,
  gateStatus: 'parked',
  gateTarget: null,
  branchState: 'active',
  expectedHead: 'abc123',
  riskTier: 'standard',
  riskDomains: ['migration'],
  pullRequest: ref,
  zulipTopic: null,
};

const approver = principalSchema.parse({
  identity: 'human:00000000-0000-4000-8000-000000000001',
  kind: 'person',
  personId: '00000000-0000-4000-8000-000000000001',
  email: 'ian.lindsley@unfoldingword.org',
  grants: [],
  interactive: true,
});

const facts: PullRequestFacts = {
  ref,
  state: 'open',
  draft: false,
  head: ' ABC123 ',
  checks: [
    { name: 'test', headSha: 'AbC123', conclusion: 'success' },
    { name: 'test', headSha: 'old999', conclusion: 'failure' },
  ],
  reviews: [
    { reviewer: 'uw-reviewer', commit: 'abc123', state: 'approved', provider: 'anthropic' },
    { reviewer: 'uw-reviewer', commit: 'old999', state: 'approved', provider: 'openai' },
    { reviewer: 'kim', commit: 'abc123', state: 'changes_requested', provider: null },
  ],
  freshAt: at,
};

function assembled(over: Partial<PullRequestFacts> | null, override = false) {
  return assembleShipInput({
    facts: over === null ? null : { ...facts, ...over },
    item,
    area: '80-89',
    approver,
    at,
    override,
  });
}

describe('KN-11 the ship rule input is assembled from the GitHub facts on the head', () => {
  it('keeps only the checks and approved reviews on the normalised head', () => {
    expect(assembled({}, true)).toEqual({
      pullRequest: { open: true, draft: false, head: 'abc123' },
      expectedHead: 'abc123',
      checks: [{ name: 'test', headSha: 'abc123', conclusion: 'success' }],
      approvals: [{ reviewer: 'uw-reviewer', commit: 'abc123', provider: 'anthropic' }],
      riskTier: 'standard',
      riskDomains: ['migration'],
      area: '80-89',
      approver,
      at: '2026-10-01T09:00:00.000Z',
      override: true,
    });
  });

  it('reads a closed or merged pull request as not open', () => {
    expect(assembled({ state: 'merged', draft: true }).pullRequest).toEqual({
      open: false,
      draft: true,
      head: 'abc123',
    });
  });

  it('assembles no pull request, checks or approvals without facts', () => {
    expect(assembled(null)).toMatchObject({ pullRequest: null, checks: [], approvals: [] });
  });

  it('ignores facts about another pull request than the item names', () => {
    const elsewhere = { repo: 'someone/else', number: 42 };
    expect(assembled({ ref: elsewhere })).toMatchObject({ pullRequest: null, approvals: [] });
    expect(assembled({ ref: { ...ref, number: 43 } }).pullRequest).toBeNull();
  });
});
