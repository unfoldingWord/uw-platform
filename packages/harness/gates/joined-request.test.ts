import { identitySchema, itemStateSchema, type ItemState } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { stagesOf } from '../port-contracts/store-gateway-fixtures.ts';
import { requestOf, type ExitInput } from './exit.ts';
import { joinedPullRequest } from './ship-input.ts';

const pullRequest = { repo: 'unfoldingWord/uw-platform', number: 7 };

const item: ItemState = itemStateSchema.parse({
  itemId: '00000000-0000-4000-8000-0000000000f4',
  harnessId: '00000000-0000-4000-8000-0000000000f5',
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
  branchState: 'none',
  expectedHead: 'a'.repeat(40),
  riskTier: 'standard',
  riskDomains: [],
  pullRequest,
  issue: null,
  zulipTopic: null,
});

const context = {
  actor: identitySchema.parse('human:00000000-0000-4000-8000-000000000001'),
  at: new Date('2026-10-15T09:00:00.000Z'),
  traceId: '00000000-0000-4000-8000-0000000000f1',
  requestId: null,
  ids: { next: () => '00000000-0000-4000-8000-0000000000f2' },
};

function exitOf(of: ItemState): ExitInput {
  return {
    item: of,
    stage: stagesOf(0x2000).ship,
    connector: 'merge',
    next: null,
    decisionId: '00000000-0000-4000-8000-0000000000f3',
    overrideReason: null,
    repository: 'unfoldingWord/uw-platform',
    expectedBase: null,
    evaluatedHead: null,
    delegated: null,
  };
}

describe('MD-3 a joined item asks the merge connector to accept its own head ref', () => {
  it('MD-3 names a joined item joined and a harness-branch item not', () => {
    expect(joinedPullRequest({ branchState: 'none', pullRequest })).toBe(true);
    expect(joinedPullRequest({ branchState: 'none', pullRequest: null })).toBe(false);
    expect(joinedPullRequest({ branchState: 'active', pullRequest })).toBe(false);
    expect(requestOf(context, exitOf(item)).joined).toBe(true);
    expect(requestOf(context, exitOf({ ...item, branchState: 'active' })).joined).toBe(false);
  });
});
