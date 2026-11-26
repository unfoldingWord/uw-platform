import { and, asc, eq, gt } from 'drizzle-orm';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import {
  resolvePolicies,
  type PolicyCandidate,
  type PolicyChain,
  type PolicyConflict,
} from '@uw/harness';
import { everyRow } from './batches.ts';
import { chainOfTarget, storedOf } from './policies.ts';
import { summaryColumns } from './reads.ts';

export type PolicyBook = {
  readonly policies: ReadonlyMap<string, PolicyCandidate>;
  readonly chains: Map<string, PolicyChain>;
};

const ORGANIZATION = '';

export async function openPolicyBook(
  db: Executor,
  extra: readonly PolicyCandidate[] = [],
): Promise<PolicyBook> {
  const rows = await everyRow((after, size) =>
    db
      .select({ ...summaryColumns, frontmatter: pages.frontmatter })
      .from(pages)
      .where(
        and(
          eq(pages.type, 'policy'),
          eq(pages.status, 'active'),
          after === null ? undefined : gt(pages.id, after),
        ),
      )
      .orderBy(asc(pages.id))
      .limit(size),
  );
  const stored = rows.flatMap((row) => storedOf(row)?.candidate ?? []);
  const policies = new Map([...stored, ...extra].map((policy) => [policy.id, policy]));
  return { policies, chains: new Map() };
}

async function chainFor(db: Executor, book: PolicyBook, target: string | null) {
  const key = target ?? ORGANIZATION;
  const known = book.chains.get(key);
  if (known !== undefined) return known;
  const chain = await chainOfTarget(db, target);
  book.chains.set(key, chain);
  return chain;
}

const holds = (chain: PolicyChain, target: string | null) =>
  chain.some((link) => link.pageId === target);

async function pairConflict(
  db: Executor,
  book: PolicyBook,
  pair: { readonly by: PolicyCandidate; readonly over: PolicyCandidate },
  on: string,
): Promise<readonly PolicyConflict[]> {
  const { by, over } = pair;
  const chains = [await chainFor(db, book, by.appliesTo), await chainFor(db, book, over.appliesTo)];
  const shared = chains.find((chain) => holds(chain, by.appliesTo) && holds(chain, over.appliesTo));
  if (shared === undefined) return [];
  return resolvePolicies(shared, [by, over], on).conflicts.filter(
    (conflict) => conflict.id === by.id && conflict.supersedes === over.id,
  );
}

export async function bookConflicts(
  db: Executor,
  book: PolicyBook,
  on: string,
  involving: (ids: readonly [string, string]) => boolean = () => true,
): Promise<readonly PolicyConflict[]> {
  const found: PolicyConflict[] = [];
  for (const by of book.policies.values()) {
    for (const id of by.supersedes) {
      const over = book.policies.get(id);
      if (over === undefined || !involving([by.id, id])) continue;
      found.push(...(await pairConflict(db, book, { by, over }, on)));
    }
  }
  return found;
}
