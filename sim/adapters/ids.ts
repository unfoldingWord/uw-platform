import type { Ids } from '@uw/harness';

export type SimIds = Ids & { issued(): number };

export function createSimIds(): SimIds {
  let count = 0;
  return {
    next: () => {
      count += 1;
      return `00000000-0000-4000-a000-${count.toString(16).padStart(12, '0')}`;
    },
    issued: () => count,
  };
}
