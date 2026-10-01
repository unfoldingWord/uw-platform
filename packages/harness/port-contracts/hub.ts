import { describe, expect, it } from 'vitest';
import type { Hub } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type HubSubject = {
  readonly hub: Hub;
  wakes(): Promise<readonly string[]>;
};

const firstHarness = 'b3000000-0000-4000-8000-000000000001';
const secondHarness = 'b3000000-0000-4000-8000-000000000002';

export function describeHubContract(adapter: string, open: () => Promise<HubSubject>): void {
  describe(`DX-3 hub port contract on ${adapter}`, () => {
    it('observes a wake for the harness it names and no other', async () => {
      const subject = await open();
      await subject.hub.wake(firstHarness);
      const wakes = await subject.wakes();
      expect(wakes).toContain(firstHarness);
      expect(wakes).not.toContain(secondHarness);
    });

    it('takes two wakes in a row for one harness', async () => {
      const subject = await open();
      await expect(subject.hub.wake(firstHarness)).resolves.toBeUndefined();
      await expect(subject.hub.wake(firstHarness)).resolves.toBeUndefined();
      expect(await subject.wakes()).toContain(firstHarness);
    });
  });
}

export function describeHubNotWired(adapter: string, hub: Hub): void {
  describeNotWired('hub', adapter, hub, { wake: true } satisfies Record<keyof Hub, true>);
}
