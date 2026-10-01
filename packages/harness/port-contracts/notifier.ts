import { describe, expect, it } from 'vitest';
import type { Notifier, Wake } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type NotifierSubject = {
  readonly notifier: Notifier;
  delivered(): Promise<readonly Wake[]>;
  failNext(): Promise<void>;
};

const wake: Wake = {
  personId: 'b4000000-0000-4000-8000-000000000001',
  harnessId: 'b4000000-0000-4000-8000-000000000002',
  itemId: 'b4000000-0000-4000-8000-000000000003',
  reason: 'gate_waiting',
  link: '/harness/b4000000-0000-4000-8000-000000000002/gates/b4000000-0000-4000-8000-000000000003',
  traceId: 'b4000000-0000-4000-8000-000000000004',
};

export function describeNotifierContract(
  adapter: string,
  open: () => Promise<NotifierSubject>,
): void {
  describe(`DX-3 notifier port contract on ${adapter}`, () => {
    it('reports a delivered wake as sent, carrying exactly what it was given', async () => {
      const subject = await open();
      expect(await subject.notifier.notify(wake)).toBe('sent');
      expect(await subject.delivered()).toEqual([wake]);
    });

    it('reports a failed send as dropped and does not retry it', async () => {
      const subject = await open();
      await subject.failNext();
      expect(await subject.notifier.notify(wake)).toBe('dropped');
      expect(await subject.delivered()).toEqual([]);
      expect(await subject.notifier.notify(wake)).toBe('sent');
      expect(await subject.delivered()).toHaveLength(1);
    });

    it('takes the person, harness, item, reason, link and trace id as its port input; the outward push payload is narrower (NT-2)', async () => {
      const subject = await open();
      await subject.notifier.notify(wake);
      const [delivered] = await subject.delivered();
      expect(Object.keys(delivered ?? {}).sort()).toEqual([
        'harnessId',
        'itemId',
        'link',
        'personId',
        'reason',
        'traceId',
      ]);
    });
  });
}

export function describeNotifierNotWired(adapter: string, notifier: Notifier): void {
  describeNotWired('notifier', adapter, notifier, { notify: true } satisfies Record<
    keyof Notifier,
    true
  >);
}
