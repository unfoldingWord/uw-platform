import { domainOf, matches, normalise } from './derive.ts';

const TOUCHED_LIMIT = 100;

export function protectedAmong(
  paths: readonly string[],
  harnessPaths: readonly string[],
): readonly string[] {
  const listed = (path: string) => harnessPaths.some((entry) => matches(entry, normalise(path)));
  return paths.filter((path) => domainOf(path) !== null || listed(path)).slice(0, TOUCHED_LIMIT);
}
