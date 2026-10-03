import { describe, expect, it } from 'vitest';
import type { Hub } from '@uw/harness';
import { unitHub } from './unit-hub.ts';

const first = 'b3000000-0000-4000-8000-000000000001';
const second = 'b3000000-0000-4000-8000-000000000002';

function recording(): { readonly hub: Hub; readonly woken: string[] } {
  const woken: string[] = [];
  return { hub: { wake: async (harnessId) => void woken.push(harnessId) }, woken };
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

  it('wakes nothing again for a unit already flushed, and wakes nothing for a unit that appended nothing', async () => {
    const target = recording();
    const unit = unitHub(target.hub);
    await unit.flush();
    await unit.hub.wake(first);
    await unit.flush();
    await unit.flush();
    expect(target.woken).toEqual([first]);
  });

  it('drops a failing wake so the unit of work still finishes', async () => {
    const woken: string[] = [];
    const failing: Hub = {
      wake: async (harnessId) => {
        if (harnessId === first) throw new Error('hub down');
        woken.push(harnessId);
      },
    };
    const unit = unitHub(failing);
    await unit.hub.wake(first);
    await unit.hub.wake(second);
    await expect(unit.flush()).resolves.toBeUndefined();
    expect(woken).toEqual([second]);
  });
});
