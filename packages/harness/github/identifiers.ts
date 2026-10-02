const identifier = /^[a-z0-9._-]+$/u;
const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const repository = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export function normalisedIdentifier(value: string): string | null {
  const folded = value.normalize('NFKC').trim().toLowerCase();
  return identifier.test(folded) ? folded : null;
}

export function fullSha(value: string): string | null {
  const folded = value.trim().toLowerCase();
  return sha.test(folded) ? folded : null;
}

export function sameRepository(a: string, b: string | null): boolean {
  if (b === null || !repository.test(a) || !repository.test(b)) return false;
  return a.toLowerCase() === b.toLowerCase();
}

export function branchFor(itemId: string): string {
  return `harness/${itemId}`;
}
