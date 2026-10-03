import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { healthReportSchema, type HealthIndicator } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { createApp } from '../app.tsx';
import type { HubNamespace } from '../env.ts';
import { softwareHarness } from '../testing/commands.ts';
import { recordingDeps } from '../testing/deps.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { systemTimers, type Timers } from '../timers.ts';
import {
  HUB_HEALTH_CACHE_MS,
  HUB_HEALTH_LIMIT,
  HUB_STATS_TIMEOUT_MS,
  hubIndicator,
} from './hub.ts';
import { DATABASE_TIMEOUT_MS } from './indicators.ts';

type HubAnswer = (harnessId: string) => Promise<Response>;

type StatsHub = { readonly namespace: HubNamespace; readonly asked: string[] };

type Probe = {
  readonly env: Record<string, unknown>;
  readonly timers?: Timers;
  readonly clock?: { now(): Date };
};

const earlier = '2026-10-03T11:00:00.000Z';
const later = '2026-10-03T12:00:00.000Z';
const oneConnection = { connections: 1, lastWakeAt: null };

function statsHub(answer: HubAnswer): StatsHub {
  const asked: string[] = [];
  const namespace: HubNamespace = {
    idFromName: (name) => name,
    get: (id) => ({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        asked.push(`${request.method} ${new URL(request.url).pathname} ${String(id)}`);
        return answer(String(id));
      },
    }),
  };
  return { namespace, asked };
}

function answering(stats: object): StatsHub {
  return statsHub(async () => Response.json(stats));
}

function statsBy(stats: ReadonlyMap<string, object>): HubAnswer {
  return async (harnessId) => Response.json(stats.get(harnessId) ?? {});
}

function healthApp(db: Database | null, probe: Omit<Probe, 'env'>) {
  const { deps } = recordingDeps();
  const handle =
    db === null ? null : { db, ping: async () => undefined, release: async () => undefined };
  return createApp({
    ...deps,
    clock: probe.clock ?? deps.clock,
    timers: probe.timers ?? systemTimers,
    openDatabase: () => handle,
  });
}

async function liveHubOf(
  app: ReturnType<typeof createApp>,
  env: Probe['env'],
): Promise<HealthIndicator | undefined> {
  const response = await app.request('/health', {}, env);
  expect(response.status).toBe(200);
  const report = healthReportSchema.parse(await response.json());
  return report.indicators.find((indicator) => indicator.name === 'live_hub');
}

function liveHub(db: Database | null, probe: Probe): Promise<HealthIndicator | undefined> {
  return liveHubOf(healthApp(db, probe), probe.env);
}

function slowTimers(): { readonly timers: Timers; readonly calls: number[] } {
  const calls: number[] = [];
  const timers: Timers = {
    after: (ms) => {
      calls.push(ms);
      return new Promise((resolve) => setTimeout(resolve, 50));
    },
  };
  return { timers, calls };
}

async function sumsAcrossHarnesses(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const stats = new Map([
    [scene.harnessId, { connections: 2, lastWakeAt: earlier }],
    [scene.otherHarnessId, { connections: 3, lastWakeAt: later }],
  ]);
  const hub = statsHub(statsBy(stats));
  const indicator = await liveHub(db, { env: { HARNESS_HUB: hub.namespace } });
  expect(indicator).toEqual({
    name: 'live_hub',
    status: 'ok',
    detail: `5 connections across 2 harnesses; last wake ${later}`,
  });
  const shown = JSON.stringify(indicator);
  expect(shown).not.toContain(scene.harnessId);
  expect(shown).not.toContain(scene.otherHarnessId);
  expect(hub.asked.sort()).toEqual(
    [`GET /stats ${scene.harnessId}`, `GET /stats ${scene.otherHarnessId}`].sort(),
  );
  const quiet = answering({ connections: 0, lastWakeAt: null });
  const idle = await liveHub(db, { env: { HARNESS_HUB: quiet.namespace } });
  expect(idle?.detail).toBe('0 connections across 2 harnesses; last wake never');
}

async function stalledHub(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const stats = { connections: 4, lastWakeAt: earlier };
  const stalled = statsHub((harnessId) =>
    harnessId === scene.harnessId
      ? Promise.resolve(Response.json(stats))
      : new Promise(() => undefined),
  );
  const { timers, calls } = slowTimers();
  expect(await liveHub(db, { env: { HARNESS_HUB: stalled.namespace }, timers })).toEqual({
    name: 'live_hub',
    status: 'amber',
    detail: `4 connections across 2 harnesses; last wake ${earlier}`,
  });
  expect(calls).toEqual([DATABASE_TIMEOUT_MS, HUB_STATS_TIMEOUT_MS]);
}

async function badAnswers(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const broken = statsHub(async (harnessId) =>
    harnessId === scene.harnessId
      ? Response.json(oneConnection)
      : new Response('no', { status: 500 }),
  );
  expect((await liveHub(db, { env: { HARNESS_HUB: broken.namespace } }))?.status).toBe('amber');
  const garbled = answering({ connections: -1, lastWakeAt: 'soon' });
  expect(await liveHub(db, { env: { HARNESS_HUB: garbled.namespace } })).toMatchObject({
    status: 'amber',
    detail: '0 connections across 2 harnesses; last wake never',
  });
}

async function cachedWindow(db: Database): Promise<void> {
  await softwareHarness(db);
  const hub = answering(oneConnection);
  let now = new Date('2026-10-03T12:00:00.000Z');
  const app = healthApp(db, { clock: { now: () => now } });
  const env = { HARNESS_HUB: hub.namespace };
  const reads = await Promise.all([1, 2, 3].map(() => liveHubOf(app, env)));
  now = new Date(now.getTime() + HUB_HEALTH_CACHE_MS - 1);
  reads.push(await liveHubOf(app, env));
  expect(new Set(reads.map((indicator) => indicator?.detail))).toEqual(
    new Set(['2 connections across 2 harnesses; last wake never']),
  );
  expect(hub.asked).toHaveLength(2);
  now = new Date(now.getTime() + 1);
  await liveHubOf(app, env);
  expect(hub.asked).toHaveLength(4);
}

describe.skipIf(!testServer)('WB-3 the live hub on /health', () => {
  it('WB-3 the live_hub indicator sums connections and reports the latest wake across harnesses', () =>
    withAppDatabase(sumsAcrossHarnesses));
});

describe.skipIf(!testServer)('the live hub indicator when a hub fails', () => {
  it('turns amber when a hub does not answer in 2 seconds', () => withAppDatabase(stalledHub));

  it('turns amber when a hub answers with an error or a body it cannot read', () =>
    withAppDatabase(badAnswers));

  it('asks each hub once per cache window however often /health is read', () =>
    withAppDatabase(cachedWindow));

  it('reports not_wired without the binding and not_configured without a database', async () => {
    const hub = answering(oneConnection);
    const unbound = await withAppDatabase((db) => liveHub(db, { env: {} }));
    expect(unbound).toEqual({ name: 'live_hub', status: 'not_wired', detail: 'no hub binding' });
    expect(await liveHub(null, { env: { HARNESS_HUB: hub.namespace } })).toEqual({
      name: 'live_hub',
      status: 'not_configured',
      detail: 'no database',
    });
    expect(hub.asked).toEqual([]);
  });
});

describe('the live hub indicator bounds its work', () => {
  it('asks at most the first 50 harnesses', async () => {
    const ids = Array.from({ length: HUB_HEALTH_LIMIT + 10 }, () => randomUUID());
    const hub = answering(oneConnection);
    const kernel = { reads: { harnessIdsForHealth: async () => ids } };
    const indicator = await hubIndicator({ HARNESS_HUB: hub.namespace }, kernel, systemTimers);
    expect(indicator.detail).toBe(
      `${HUB_HEALTH_LIMIT} connections across ${HUB_HEALTH_LIMIT} harnesses; last wake never`,
    );
    expect(hub.asked).toEqual(ids.slice(0, HUB_HEALTH_LIMIT).map((id) => `GET /stats ${id}`));
  });

  it('turns amber when the harness list cannot be read', async () => {
    const hub = answering(oneConnection);
    const kernel = {
      reads: { harnessIdsForHealth: () => Promise.reject(new Error('database gone')) },
    };
    const indicator = await hubIndicator({ HARNESS_HUB: hub.namespace }, kernel, systemTimers);
    expect(indicator).toEqual({
      name: 'live_hub',
      status: 'amber',
      detail: 'harness list unreadable',
    });
    expect(hub.asked).toEqual([]);
  });
});
