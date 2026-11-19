import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { PageFacts, StoreTransaction } from '../ports.ts';

export async function pageView(
  tx: StoreTransaction,
  caller: Caller,
  pageId: string,
  at: Date,
): Promise<KernelOutcome<PageFacts>> {
  const [page] = await tx.pages.read.facts([pageId]);
  if (page === undefined || !allowed(caller.actor, 'read', page, at)) {
    return refused('page_not_found', { pageId });
  }
  return accepted(page);
}
