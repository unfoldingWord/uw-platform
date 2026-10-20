import { itemStateSchema, type ItemState } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { PullRequestAuthor, PullRequestRef } from '../ports.ts';
import { listsAuthor, pullRequestKey, uncountedItems } from './bots.ts';

const repo = 'unfoldingWord/tc-admin-app';

function item(n: number, pullRequest: PullRequestRef | null): ItemState {
  return itemStateSchema.parse({
    itemId: `00000000-0000-4000-8000-00000000000${n}`,
    harnessId: '00000000-0000-4000-8000-0000000000a1',
    stageKey: 'check',
    title: `Item ${n}`,
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
    expectedHead: pullRequest === null ? null : 'a'.repeat(40),
    riskTier: null,
    riskDomains: [],
    pullRequest,
    issue: null,
    zulipTopic: null,
  });
}

function answering(found: readonly PullRequestAuthor[]) {
  const asked: PullRequestRef[][] = [];
  return {
    asked,
    facts: {
      authors: async (refs: readonly PullRequestRef[]) => {
        asked.push([...refs]);
        return found;
      },
    },
  };
}

describe('OB-4 which items no count includes', () => {
  it('OB-4 leaves out a pull request a listed bot opened, in any case, and counts an unknown author', async () => {
    const bot = item(1, { repo, number: 7 });
    const person = item(2, { repo, number: 8 });
    const unknown = item(3, { repo, number: 9 });
    const plain = item(4, null);
    const { facts, asked } = answering([
      { ref: { repo: repo.toUpperCase(), number: 7 }, author: 'Dependabot[bot]' },
      { ref: { repo, number: 8 }, author: 'outside-reviewer' },
    ]);
    const harness = { botAuthors: ['dependabot[bot]'] };
    const left = await uncountedItems(facts, [{ harness, items: [bot, person, unknown, plain] }]);
    expect([...left]).toEqual([bot.itemId]);
    expect(asked).toEqual([
      [
        { repo, number: 7 },
        { repo, number: 8 },
        { repo, number: 9 },
      ],
    ]);
  });

  it('OB-4 asks nothing for a harness that lists no bot', async () => {
    const { facts, asked } = answering([]);
    const left = await uncountedItems(facts, [
      { harness: { botAuthors: [] }, items: [item(1, { repo, number: 7 })] },
    ]);
    expect(left.size).toBe(0);
    expect(asked).toEqual([]);
  });

  it('OB-4 keys a pull request in any case and matches a login in any case', () => {
    expect(pullRequestKey({ repo: 'UnfoldingWord/TC', number: 3 })).toBe('unfoldingword/tc#3');
    expect(listsAuthor({ botAuthors: ['renovate[bot]'] }, 'Renovate[bot]')).toBe(true);
    expect(listsAuthor({ botAuthors: ['renovate[bot]'] }, 'renovate')).toBe(false);
  });
});
