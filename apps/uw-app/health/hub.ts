import { z } from 'zod';
import type { HealthIndicator } from '@uw/contracts';
import type { Kernel } from '@uw/harness';
import type { Bindings, HubNamespace } from '../env.ts';
import type { Timers } from '../timers.ts';

export const HUB_HEALTH_LIMIT = 50;
export const HUB_STATS_TIMEOUT_MS = 2_000;
export const HUB_HEALTH_CACHE_MS = 30_000;

const NAME = 'live_hub';
const HUB_STATS_URL = 'https://hub.internal/stats';

const statsSchema = z.strictObject({
  connections: z.number().int().nonnegative().max(1_000_000),
  lastWakeAt: z.iso.datetime().nullable(),
});

type Stats = z.infer<typeof statsSchema>;
type TimedOut = 'timed_out';
type HubReads = { readonly reads: Pick<Kernel['reads'], 'harnessIdsForHealth'> };

export type HubHealth = (
  env: Bindings,
  kernel: HubReads | null,
  timers: Timers,
) => Promise<HealthIndicator>;

async function statsOf(
  namespace: HubNamespace,
  harnessId: string,
  deadline: Promise<TimedOut>,
): Promise<Stats | null> {
  try {
    const stub = namespace.get(namespace.idFromName(harnessId));
    const answer = await Promise.race([stub.fetch(HUB_STATS_URL, { method: 'GET' }), deadline]);
    if (answer === 'timed_out' || answer.status !== 200) return null;
    const body: unknown = await Promise.race([answer.json(), deadline]);
    const parsed = statsSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function latestWake(answered: readonly Stats[]): string {
  const wakes = answered.flatMap((stats) =>
    stats.lastWakeAt === null ? [] : [Date.parse(stats.lastWakeAt)],
  );
  return wakes.length === 0 ? 'never' : new Date(Math.max(...wakes)).toISOString();
}

function summary(polled: readonly (Stats | null)[]): HealthIndicator {
  const answered = polled.filter((stats): stats is Stats => stats !== null);
  const connections = answered.reduce((total, stats) => total + stats.connections, 0);
  const detail = `${connections} connections across ${polled.length} harnesses; last wake ${latestWake(answered)}`;
  const status = answered.length === polled.length ? 'ok' : 'amber';
  return { name: NAME, status, detail };
}

async function pollHubs(
  namespace: HubNamespace,
  kernel: HubReads,
  timers: Timers,
): Promise<HealthIndicator> {
  const stop = new AbortController();
  try {
    const deadline = timers
      .after(HUB_STATS_TIMEOUT_MS, stop.signal)
      .then((): TimedOut => 'timed_out');
    const ids = await Promise.race([kernel.reads.harnessIdsForHealth(), deadline]);
    if (ids === 'timed_out') throw new Error('harness list timed out');
    const polled = ids.slice(0, HUB_HEALTH_LIMIT);
    return summary(await Promise.all(polled.map((id) => statsOf(namespace, id, deadline))));
  } catch {
    return { name: NAME, status: 'amber', detail: 'harness list unreadable' };
  } finally {
    stop.abort();
  }
}

export function hubIndicator(
  env: Bindings,
  kernel: HubReads | null,
  timers: Timers,
): Promise<HealthIndicator> {
  const namespace = env.HARNESS_HUB;
  if (namespace === undefined) {
    return Promise.resolve({ name: NAME, status: 'not_wired', detail: 'no hub binding' });
  }
  if (kernel === null) {
    return Promise.resolve({ name: NAME, status: 'not_configured', detail: 'no database' });
  }
  return pollHubs(namespace, kernel, timers);
}

export function cachedHubHealth(now: () => number): HubHealth {
  let held: { readonly at: number; readonly indicator: HealthIndicator } | null = null;
  return async (env, kernel, timers) => {
    if (env.HARNESS_HUB === undefined || kernel === null) return hubIndicator(env, kernel, timers);
    const asked = now();
    if (held !== null && asked >= held.at && asked - held.at < HUB_HEALTH_CACHE_MS) {
      return held.indicator;
    }
    const indicator = await hubIndicator(env, kernel, timers);
    held = { at: asked, indicator };
    return indicator;
  };
}
