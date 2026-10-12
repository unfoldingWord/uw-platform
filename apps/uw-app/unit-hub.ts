import type { Hub } from '@uw/harness';

export type UnitHub = { readonly hub: Hub; owed(): number; flush(): Promise<void> };

export function unitHub(target: Hub): UnitHub {
  const pending = new Set<string>();
  let flushed = false;
  return {
    hub: {
      wake: async (harnessId) => {
        if (flushed) return target.wake(harnessId);
        pending.add(harnessId);
      },
      present: (query) => target.present(query),
    },
    owed: () => pending.size,
    flush: async () => {
      flushed = true;
      const woken = [...pending];
      pending.clear();
      await Promise.allSettled(woken.map(async (harnessId) => target.wake(harnessId)));
    },
  };
}
