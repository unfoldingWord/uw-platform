import type { Hub } from '@uw/harness';

export type SimHub = Hub & { wakes(): readonly string[] };

export function createSimHub(): SimHub {
  const wakes: string[] = [];
  return {
    wake: async (harnessId) => {
      wakes.push(harnessId);
    },
    wakes: () => [...wakes],
  };
}
