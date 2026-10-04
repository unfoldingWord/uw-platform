import { describe, expect, it } from 'vitest';
import type { Hub } from '@uw/harness';
import { unitHub } from './unit-hub.ts';

const first = 'b3000000-0000-4000-8000-000000000001';
const second = 'b3000000-0000-4000-8000-000000000002';

function recording(): { readonly hub: Hub; readonly woken: string[] } {
  const woken: string[] = [];
  return {
    hub: { wake: async (harnessId) => void woken.push(harnessId), present: async () => false },
    woken,
  };
}

describe('the queue and cron hub wakes each harness once per unit of work', () => {
  it('holds every wake until the unit ends, then wakes each harness it named once', async () => {
    const target = recording();
    const unit = unitHub(target.hub);
    await unit.hub.wake(first);
    await unit.hub.wake(second);
    await unit.hub.wake(first);
    expect(target.woken).toEqual([]);
    await unit.flush();
    expect(target.woken).toEqual([first, second]);
  });

  it('wakes nothing for a unit that appended nothing, and nothing again on a second flush', async () => {
    const target = recording();
    const unit = unitHub(target.hub);
    await unit.flush();
    expect(target.woken).toEqual([]);
    await unit.hub.wake(first);
    await unit.flush();
    await unit.flush();
    expect(target.woken).toEqual([first]);
  });

  it('forwards a wake that arrives after the unit has flushed straight to the hub', async () => {
    const target = recording();
    const unit = unitHub(target.hub);
    await unit.hub.wake(first);
    await unit.flush();
    await unit.hub.wake(second);
    expect(target.woken).toEqual([first, second]);
  });

  it('drops a failing wake so the unit of work still finishes', async () => {
    const woken: string[] = [];
    const failing: Hub = {
      wake: async (harnessId) => {
        if (harnessId === first) throw new Error('hub down');
        woken.push(harnessId);
      },
      present: async () => false,
    };
    const unit = unitHub(failing);
    await unit.hub.wake(first);
    await unit.hub.wake(second);
    await expect(unit.flush()).resolves.toBeUndefined();
    expect(woken).toEqual([second]);
  });
});

describe('the sweep counts the wakes a unit of work owes', () => {
  it('owes one wake per harness it named until it flushes', async () => {
    const unit = unitHub(recording().hub);
    expect(unit.owed()).toBe(0);
    await unit.hub.wake(first);
    await unit.hub.wake(first);
    await unit.hub.wake(second);
    expect(unit.owed()).toBe(2);
    await unit.flush();
    expect(unit.owed()).toBe(0);
  });
});
