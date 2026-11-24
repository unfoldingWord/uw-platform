import type { CollectionDefinition, ReadThroughFeed, ReadThroughValue } from '@uw/contracts';

type Resolver = (definition: CollectionDefinition) => ReadThroughValue['state'];

const notWired: Resolver = () => 'not_wired';
const moneyOnProjects: Resolver = (definition) =>
  definition.pageType === 'project' ? 'no_budget_lines' : 'not_wired';

const resolverTable: Readonly<Record<ReadThroughFeed, Resolver>> = {
  budget: moneyOnProjects,
  actuals: moneyOnProjects,
  committed: moneyOnProjects,
  remaining_need: moneyOnProjects,
  balance: moneyOnProjects,
  income_by_source: moneyOnProjects,
  sage_program_id: notWired,
};

const resolvers: ReadonlyMap<string, Resolver> = new Map(Object.entries(resolverTable));

export function readThroughValue(
  definition: CollectionDefinition,
  feed: ReadThroughFeed,
): ReadThroughValue {
  return { feed, state: (resolvers.get(feed) ?? notWired)(definition) };
}
