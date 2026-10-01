import type { IngestEnvelope } from '@uw/contracts';
import type { DeliveryLedger } from '../deliveries/ledger.ts';
import type { QueueSendOptions } from '../env.ts';

export function recordingQueue() {
  const sent: IngestEnvelope[] = [];
  const options: (QueueSendOptions | undefined)[] = [];
  let failures = 0;
  return {
    sent,
    options,
    send: async (body: IngestEnvelope, sendOptions?: QueueSendOptions): Promise<void> => {
      options.push(sendOptions);
      if (failures > 0) {
        failures -= 1;
        throw new Error('queue unavailable');
      }
      sent.push(body);
    },
    failNext: (): void => {
      failures += 1;
    },
  };
}

export function memoryLedger(): DeliveryLedger & { readonly keys: Set<string> } {
  const keys = new Set<string>();
  return {
    keys,
    claim: async (source, deliveryId) => {
      const key = `${source}:${deliveryId}`;
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    },
    release: async (source, deliveryId) => {
      keys.delete(`${source}:${deliveryId}`);
    },
  };
}
