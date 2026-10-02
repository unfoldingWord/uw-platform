import { expect, it } from 'vitest';
import type { Store } from '../ports.ts';
import { at, harnessOf, refusedBy } from './store-gateway-fixtures.ts';

type HarnessesSubject = () => { readonly store: Store };

export function describeHarnessRepositories(subject: HarnessesSubject): void {
  it('DX-3 finds a harness by its repository in any case, and nothing for another repository', async () => {
    const harness = harnessOf(0x1900, 'gateway-repository', 'unfoldingWord/Gateway-Repo');
    const found = await subject().store.transaction(async (tx) => {
      await tx.harnesses.write.insert(harness, at);
      await tx.harnesses.write.insert(harnessOf(0x1a00, 'gateway-repository-none'), at);
      return {
        exact: await tx.harnesses.read.byRepository('unfoldingWord/Gateway-Repo'),
        folded: await tx.harnesses.read.byRepository('UNFOLDINGWORD/gateway-repo'),
        unknown: await tx.harnesses.read.byRepository('unfoldingWord/gateway-repo-none'),
      };
    });
    expect(found).toEqual({ exact: harness, folded: harness, unknown: null });
  });

  it('DX-3 finds nothing for a repository that is not a GitHub owner/name, even one that folds to a stored repository', async () => {
    const found = await subject().store.transaction(async (tx) => {
      await tx.harnesses.write.insert(
        harnessOf(0x1d00, 'gateway-repo-key', 'unfoldingWord/key'),
        at,
      );
      return {
        stored: await tx.harnesses.read.byRepository('unfoldingWord/KEY'),
        kelvin: await tx.harnesses.read.byRepository('unfoldingWord/\u212Aey'),
        dots: await tx.harnesses.read.byRepository('unfoldingWord/..'),
      };
    });
    expect({ stored: found.stored?.key, kelvin: found.kelvin, dots: found.dots }).toEqual({
      stored: 'gateway-repo-key',
      kelvin: null,
      dots: null,
    });
  });

  it('DX-3 refuses a second harness whose repository differs only in case as a StoreRefusedError 23505', async () => {
    const outcome = await refusedBy(async (tx) => {
      await tx.harnesses.write.insert(harnessOf(0x1b00, 'gateway-repo-a', 'unfoldingWord/dup'), at);
      await tx.harnesses.write.insert(harnessOf(0x1c00, 'gateway-repo-b', 'UnfoldingWord/DUP'), at);
    }, subject().store);
    expect(outcome).toMatchObject({
      code: '23505',
      constraint: 'harnesses_repository_once',
      table: 'harnesses',
    });
  });
}
