import type { Harness, ItemState } from '@uw/contracts';
import type { GitHubFacts, PullRequestRef } from '../ports.ts';

export type CountScope = {
  readonly harness: Pick<Harness, 'botAuthors'>;
  readonly items: readonly ItemState[];
};

type Watched = {
  readonly harness: Pick<Harness, 'botAuthors'>;
  readonly itemId: string;
  readonly ref: PullRequestRef;
};

export function pullRequestKey(ref: PullRequestRef): string {
  return `${ref.repo.toLowerCase()}#${ref.number}`;
}

export function listsAuthor(harness: Pick<Harness, 'botAuthors'>, author: string): boolean {
  const login = author.toLowerCase();
  return harness.botAuthors.some((bot) => bot.toLowerCase() === login);
}

function watchedOf(scopes: readonly CountScope[]): readonly Watched[] {
  return scopes.flatMap(({ harness, items }) =>
    harness.botAuthors.length === 0
      ? []
      : items.flatMap((item) =>
          item.pullRequest === null
            ? []
            : [{ harness, itemId: item.itemId, ref: item.pullRequest }],
        ),
  );
}

export async function uncountedItems(
  facts: Pick<GitHubFacts, 'authors'>,
  scopes: readonly CountScope[],
): Promise<ReadonlySet<string>> {
  const watched = watchedOf(scopes);
  if (watched.length === 0) return new Set();
  const found = await facts.authors(watched.map(({ ref }) => ref));
  const authors = new Map(found.map(({ ref, author }) => [pullRequestKey(ref), author]));
  const left = watched.filter(({ harness, ref }) => {
    const author = authors.get(pullRequestKey(ref));
    return author !== undefined && listsAuthor(harness, author);
  });
  return new Set(left.map(({ itemId }) => itemId));
}
