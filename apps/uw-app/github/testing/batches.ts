import { factsFromWebhook } from '../facts/normalise.ts';
import type { FactBatch } from '../facts/records.ts';

export function webhookBatch(event: string, payload: unknown): FactBatch {
  const delivery = factsFromWebhook(event, payload);
  if (delivery.kind !== 'facts') throw new TypeError(`fixture ${event} is ${delivery.kind}`);
  return delivery.batch;
}
