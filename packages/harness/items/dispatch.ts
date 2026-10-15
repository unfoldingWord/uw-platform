import { platformFrontmatterSchema, type Harness } from '@uw/contracts';
import { sameRepository } from '../github/identifiers.ts';
import { refused, type Refused } from '../outcome.ts';
import type { StoreTransaction } from '../ports.ts';

type DispatchTransaction = Pick<StoreTransaction, 'pages'>;
type DispatchHarness = Pick<Harness, 'jdArea' | 'repository'>;

async function dispatchList(
  tx: DispatchTransaction,
  jdArea: string,
): Promise<readonly string[] | null> {
  const page = await tx.pages.read.platformFor(jdArea);
  if (page === null || page.type !== 'platform' || page.status !== 'active') return null;
  const parsed = platformFrontmatterSchema.safeParse(page.frontmatter);
  return parsed.success ? parsed.data.dispatch_allowed : null;
}

export async function dispatchRefusal(
  tx: DispatchTransaction,
  harness: DispatchHarness,
): Promise<Refused | null> {
  const { repository } = harness;
  if (repository === null) return null;
  const allowed = await dispatchList(tx, harness.jdArea);
  if (allowed === null) return refused('dispatch_list_unavailable', { jdArea: harness.jdArea });
  if (allowed.some((entry) => sameRepository(entry, repository))) return null;
  return refused('repository_not_dispatchable', { repository });
}
