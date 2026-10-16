import type {
  Clock,
  DiffRange,
  DiffRead,
  EpicFacts,
  GitHubFacts,
  IssueKey,
  PullRequestAuthor,
  PullRequestFacts,
  PullRequestRef,
} from '@uw/harness';

export type SimGitHubFacts = GitHubFacts & {
  given(facts: PullRequestFacts): void;
  setDiff(ref: PullRequestRef, range: DiffRange, text: string): void;
  givenEpic(epic: EpicFacts): void;
  givenAuthor(ref: PullRequestRef, author: string): void;
};

const keyOf = (ref: PullRequestRef): string => `${ref.repo.toLowerCase()}#${ref.number}`;
const issueKeyOf = (key: IssueKey): string => `${key.repo.toLowerCase()}#${key.number}`;
const diffKeyOf = (ref: PullRequestRef, range: DiffRange): string =>
  JSON.stringify([keyOf(ref), range.base, range.head]);

function readDiff(text: string | undefined, budgetBytes: number): DiffRead {
  if (text === undefined) return { kind: 'unavailable', reason: 'no_diff' };
  const bytes = new TextEncoder().encode(text).length;
  const usable = Number.isSafeInteger(budgetBytes) && budgetBytes >= 0;
  return usable && bytes <= budgetBytes
    ? { kind: 'diff', text, bytes }
    : { kind: 'too_large', bytes };
}

export function createSimGitHubFacts(clock: Clock): SimGitHubFacts {
  const known = new Map<string, PullRequestFacts>();
  const diffs = new Map<string, string>();
  const epics = new Map<string, EpicFacts>();
  const authors = new Map<string, PullRequestAuthor>();
  const answer = async (ref: PullRequestRef): Promise<PullRequestFacts | null> => {
    const found = known.get(keyOf(ref));
    return found ? structuredClone(found) : null;
  };
  return {
    pullRequest: answer,
    refresh: async (ref) => {
      const found = await answer(ref);
      return found === null ? null : { ...found, freshAt: clock.now() };
    },
    diff: async (ref, range, budgetBytes) =>
      readDiff(diffs.get(diffKeyOf(ref, range)), budgetBytes),
    given: (facts) => {
      known.set(keyOf(facts.ref), structuredClone(facts));
    },
    setDiff: (ref, range, text) => {
      diffs.set(diffKeyOf(ref, range), text);
    },
    epic: async (key) => {
      const found = epics.get(issueKeyOf(key));
      return found ? structuredClone(found) : null;
    },
    givenEpic: (epic) => {
      epics.set(issueKeyOf(epic.epic.issue), structuredClone(epic));
    },
    authors: async (refs) =>
      refs.flatMap((ref) => {
        const found = authors.get(keyOf(ref));
        return found === undefined ? [] : [structuredClone(found)];
      }),
    givenAuthor: (ref, author) => {
      authors.set(keyOf(ref), { ref: { ...ref }, author });
    },
  };
}
