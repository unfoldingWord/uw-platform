import { z } from 'zod';
import type { Logger } from '@uw/core/log';
import type { Hub, PresenceQuery } from '@uw/harness';
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

const presenceSchema = z.strictObject({ present: z.boolean() });

function presenceUrl(query: PresenceQuery): string {
  const params = new URLSearchParams({ person: query.personId, screen: query.screen });
  if (query.itemId !== null) params.set('item', query.itemId);
  return `https://hub.internal/presence?${params.toString()}`;
}

async function presentOn(
  namespace: HubNamespace,
  timers: Timers,
  query: PresenceQuery,
): Promise<boolean | null> {
  const stub = namespace.get(namespace.idFromName(query.harnessId));
  const answer = await bounded(stub.fetch(presenceUrl(query), { method: 'GET' }), timers);
  if (answer === 'timed_out' || answer.status !== 200) return null;
  const parsed = presenceSchema.safeParse(await answer.json().catch(() => null));
  return parsed.success ? parsed.data.present : null;
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
    present: async (query) => {
      const present = await presentOn(namespace, timers, query).catch(() => null);
      if (present !== null) return present;
      logger.warn('hub presence unknown', {
        outcome: 'hub_presence_unknown',
        harness_id: query.harnessId,
      });
      return false;
    },
  };
}

export function hubOf(env: Bindings, logger: Logger): Hub {
  return env.HARNESS_HUB ? platformHub(env.HARNESS_HUB, logger, systemTimers) : hubNotWired;
}
