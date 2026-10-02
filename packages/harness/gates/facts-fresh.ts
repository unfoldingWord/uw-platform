import { refused, type Refused } from '../outcome.ts';
import type { PullRequestFacts } from '../ports.ts';

const FACTS_FRESH_MS = 60_000;

export function isStale(facts: PullRequestFacts, at: Date): boolean {
  return Math.abs(facts.freshAt.getTime() - at.getTime()) > FACTS_FRESH_MS;
}

export function staleRefusal(facts: PullRequestFacts | null): Refused {
  return refused('facts_stale', { freshAt: facts === null ? null : facts.freshAt.toISOString() });
}
