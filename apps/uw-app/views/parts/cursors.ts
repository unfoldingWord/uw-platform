import type { HarnessCursor } from '@uw/harness';

export function liveCursors(
  cursors: readonly HarnessCursor[],
  harnessIds: readonly string[],
): readonly HarnessCursor[] {
  const latest = new Map(cursors.map((entry) => [entry.harnessId, entry.cursor]));
  return [...new Set(harnessIds)].map((harnessId) => ({
    harnessId,
    cursor: latest.get(harnessId) ?? 0,
  }));
}
