import type { PullRequestFacts } from '../ports.ts';
import { fullSha } from './identifiers.ts';

export function pathsComparedAt(facts: PullRequestFacts, head: string): readonly string[] | null {
  const base = fullSha(facts.base);
  if (facts.files === null || base === null) return null;
  if (fullSha(facts.files.head) !== head || fullSha(facts.files.base) !== base) return null;
  return facts.files.paths;
}
