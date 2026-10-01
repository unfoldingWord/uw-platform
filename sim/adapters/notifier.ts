import type { Notifier, Wake } from '@uw/harness';

export type SimNotifier = Notifier & { delivered(): readonly Wake[]; failNext(): void };

export function createSimNotifier(): SimNotifier {
  const delivered: Wake[] = [];
  let failing = false;
  return {
    notify: async (wake) => {
      if (failing) {
        failing = false;
        return 'dropped';
      }
      delivered.push(structuredClone(wake));
      return 'sent';
    },
    delivered: () => delivered.map((wake) => structuredClone(wake)),
    failNext: () => {
      failing = true;
    },
  };
}
