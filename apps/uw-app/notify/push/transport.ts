import { buildPushPayload } from '@block65/webcrypto-web-push';
import { pushPayloadSchema, type PushPayload } from '@uw/contracts';
import type { Timers } from '../../timers.ts';
import type { PushConfig } from '../config.ts';
import type { PushDevice } from './store.ts';

const SEND_TIMEOUT_MS = 5_000;
const TTL_SECONDS = 3_600;
const STRONGEST_RANK = 3;

export type BuildRequest = typeof buildPushPayload;

export type PushTransport = {
  send(device: PushDevice, payload: PushPayload, rank: number): Promise<number | 'failed'>;
};

async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, timers: Timers) {
  const stop = new AbortController();
  try {
    const expiry = timers.after(SEND_TIMEOUT_MS, stop.signal).then(() => 'failed' as const);
    return await Promise.race([work(stop.signal), expiry]);
  } finally {
    stop.abort();
  }
}

export function webPushTransport(
  config: PushConfig,
  fetcher: typeof fetch,
  timers: Timers,
  buildRequest: BuildRequest = buildPushPayload,
): PushTransport {
  const vapid = {
    subject: config.subject,
    publicKey: config.publicKey,
    privateKey: config.privateJwk.d,
  };
  return {
    send: async (device, payload, rank) => {
      const data = pushPayloadSchema.parse(payload);
      const urgency = rank === STRONGEST_RANK ? 'high' : 'normal';
      const subscription = {
        endpoint: device.endpoint,
        expirationTime: null,
        keys: { p256dh: device.p256dh, auth: device.auth },
      };
      const send = async (signal: AbortSignal) => {
        const request = await buildRequest(
          { data, options: { ttl: TTL_SECONDS, urgency } },
          subscription,
          vapid,
        );
        const answer = await fetcher(device.endpoint, {
          method: 'POST',
          headers: request.headers,
          body: request.body,
          signal,
        });
        return answer.status;
      };
      return bounded(send, timers).catch(() => 'failed' as const);
    },
  };
}
