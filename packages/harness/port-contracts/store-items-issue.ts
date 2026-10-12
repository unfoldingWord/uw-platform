import { expect, it } from 'vitest';
import type { Store } from '../ports.ts';
import { at, itemOf, refusedBy, seedHarness, uid } from './store-gateway-fixtures.ts';

type ItemsSubject = () => { readonly store: Store };

const issue = { repo: 'unfoldingWord/uw-platform', number: 42, githubId: 9100000201 };

export function describeItemIssues(subject: ItemsSubject): void {
  it('DX-3 finds the item wrapping an issue by its GitHub id, and nothing for another issue', async () => {
    const wrapping = itemOf(0x2000, 1, { issue });
    const found = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x2000, 'gateway-issue');
      await tx.harnessItems.write.insert(wrapping, at);
      await tx.harnessItems.write.insert(itemOf(0x2000, 2), at);
      return {
        wrapped: await tx.harnessItems.read.byIssue(issue.githubId),
        other: await tx.harnessItems.read.byIssue(issue.githubId + 1),
      };
    });
    expect(found).toEqual({ wrapped: wrapping, other: null });
  });

  it('DX-3 refuses a second item wrapping the same issue as a StoreRefusedError 23505', async () => {
    const outcome = await refusedBy(async (tx) => {
      await seedHarness(tx, 0x2100, 'gateway-issue-twice');
      await tx.harnessItems.write.insert(itemOf(0x2100, 1, { issue }), at);
      await tx.harnessItems.write.insert(
        itemOf(0x2100, 2, { issue: { ...issue, number: 43 } }),
        at,
      );
    }, subject().store);
    expect(outcome).toMatchObject({
      code: '23505',
      constraint: 'harness_items_issue_once',
      table: 'harness_items',
    });
    const left = await subject().store.transaction((tx) =>
      tx.harnessItems.read.byId(uid(0x2100 + 11)),
    );
    expect(left).toBeNull();
  });
}
