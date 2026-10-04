import type { Logger } from '@uw/core/log';
import type { Hub } from '@uw/harness';
import type { Bindings, HubNamespace } from '../env.ts';
import { systemTimers, type Timers } from '../timers.ts';
import { hubNotWired } from './hub.not-wired.ts';

const WAKE_TIMEOUT_MS = 2_000;

async function bounded(answer: Promise<Response>, timers: Timers): Promise<Response | 'timed_out'> {
  const stop = new AbortController();
  try {
    const expiry = timers.after(WAKE_TIMEOUT_MS, stop.signal).then(() => 'timed_out' as const);
    return await Promise.race([answer, expiry]);
  } finally {
    stop.abort();
  }
}

export function platformHub(namespace: HubNamespace, logger: Logger, timers: Timers): Hub {
  return {
    wake: async (harnessId) => {
      const stub = namespace.get(namespace.idFromName(harnessId));
      const answer = await bounded(
        stub.fetch('https://hub.internal/wake', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ harnessId }),
        }),
        timers,
      );
      if (answer === 'timed_out') {
        logger.warn('hub wake timed out', {
          outcome: 'hub_wake_timed_out',
          harness_id: harnessId,
          timeout_ms: WAKE_TIMEOUT_MS,
        });
        return;
      }
      if (answer.status !== 202) {
        logger.warn('hub wake refused', {
          outcome: 'hub_wake_refused',
          harness_id: harnessId,
          status: answer.status,
        });
        throw new Error(`hub wake answered ${answer.status}`);
      }
    },
    present: async () => false,
  };
}

export function hubOf(env: Bindings, logger: Logger): Hub {
  return env.HARNESS_HUB ? platformHub(env.HARNESS_HUB, logger, systemTimers) : hubNotWired;
}
