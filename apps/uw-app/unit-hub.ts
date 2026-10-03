import type { Hub } from '@uw/harness';

export type UnitHub = { readonly hub: Hub; flush(): Promise<number> };

export function unitHub(target: Hub, reserved = Number.POSITIVE_INFINITY): UnitHub {
  const pending = new Set<string>();
  let flushed = false;
  return {
    hub: {
      wake: async (harnessId) => {
        if (flushed) return target.wake(harnessId);
        pending.add(harnessId);
      },
    },
    flush: async () => {
      flushed = true;
      const woken = [...pending];
      pending.clear();
      const kept = woken.slice(0, reserved);
      await Promise.allSettled(kept.map(async (harnessId) => target.wake(harnessId)));
      return woken.length - kept.length;
    },
  };
}
