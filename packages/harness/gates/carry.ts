import type { BaseComparison } from '../ports.ts';

export function carriedCommits(comparison: BaseComparison, head: string): readonly string[] {
  const { commits, patchId, patchIds } = comparison;
  if (commits === null || patchId === null || comparison.head !== head) return [];
  const at = commits.findIndex((commit) => commit.sha === head);
  const carried: string[] = [];
  for (let index = at - 1; index >= 0; index -= 1) {
    const after = commits.at(index + 1);
    const commit = commits.at(index);
    if (after === undefined || commit === undefined || !after.merge) break;
    if (patchIds[commit.sha] === patchId) carried.push(commit.sha);
  }
  return carried;
}
