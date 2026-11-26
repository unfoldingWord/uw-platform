import type { AnyExecutor } from './any-database.ts';
import { pageSuggestionSets } from './schema.ts';

export type SeedSuggestionSet = {
  readonly pageId: string;
  readonly proposedBy: string;
  readonly title: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly bodyMd: string;
  readonly at: Date;
  readonly revision?: number;
};

export async function seedSuggestionSet(db: AnyExecutor, held: SeedSuggestionSet): Promise<string> {
  const id = crypto.randomUUID();
  const { at, ...set } = held;
  await db
    .insert(pageSuggestionSets)
    .values({ id, baseVersion: 1, status: 'pending', proposedAt: at, ...set });
  return id;
}
