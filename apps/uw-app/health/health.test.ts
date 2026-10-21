import { describe, expect, it } from 'vitest';
import { createClient } from '@uw/db/client';
import { healthReportSchema, type HealthIndicator } from '@uw/contracts';
import { createApp } from '../app.tsx';
import type { Bindings } from '../env.ts';
import { hyperdriveDatabase, type DatabaseHandle } from '../database.ts';
import { platformDeps } from '../deps.ts';
import { fixtureAccessEnv } from '../testing/access-keys.ts';
import { recordingDeps } from '../testing/deps.ts';
import { systemTimers, type Timers } from '../timers.ts';
import { DATABASE_TIMEOUT_MS, overallStatus } from './indicators.ts';

const commit = '0123456789abcdef0123456789abcdef01234567';
const indicatorNames = ['commit', 'database', 'queue', 'live_hub'];

function handleWithPing(ping: () => Promise<void>): DatabaseHandle {
  return {
    db: createClient('postgres://unused@127.0.0.1:1/unused'),
    ping,
    release: async () => undefined,
  };
}

async function getHealth(
  openDatabase: () => DatabaseHandle | null,
  headers: HeadersInit = {},
  timers: Timers = systemTimers,
) {
  const { deps } = recordingDeps();
  return createApp({ ...deps, openDatabase, timers }).request(
    '/health/probe',
    { headers },
    { COMMIT_SHA: commit },
  );
}

function answeringPing(): Promise<void> {
  return Promise.resolve();
}

function rejectingPing(): Promise<void> {
  return Promise.reject(new Error('password authentication failed'));
}

function neverPing(): Promise<void> {
  return new Promise(() => undefined);
}

function statusOf(indicators: readonly HealthIndicator[], name: string): string | undefined {
  return indicators.find((indicator) => indicator.name === name)?.status;
}

function indicator(status: HealthIndicator['status']): HealthIndicator {
  return { name: 'x', status, detail: '' };
}

describe('FD-11 and FD-12 the health report', () => {
  it('reports ok with the database and queue not configured and the hub not wired when nothing is bound', async () => {
    const response = await getHealth(() => null);
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).toContain(`"commit":"${commit}"`);
    const report = healthReportSchema.parse(JSON.parse(raw));
    expect(report.status).toBe('ok');
    expect(report.indicators.map((i) => i.name)).toEqual(indicatorNames);
    expect(statusOf(report.indicators, 'commit')).toBe('ok');
    expect(statusOf(report.indicators, 'database')).toBe('not_configured');
    expect(statusOf(report.indicators, 'queue')).toBe('not_configured');
    expect(statusOf(report.indicators, 'live_hub')).toBe('not_wired');
  });

  it('turns the database red and answers 200 when it is unreachable', async () => {
    const response = await getHealth(() => handleWithPing(rejectingPing));
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain('password');
    const report = healthReportSchema.parse(JSON.parse(raw));
    expect(statusOf(report.indicators, 'database')).toBe('red');
    expect(report.status).toBe('red');
  });

  it('turns the database red once the timeout fires when it never answers', async () => {
    const calls: number[] = [];
    const timers: Timers = {
      after: async (ms) => {
        calls.push(ms);
      },
    };
    const response = await getHealth(() => handleWithPing(neverPing), {}, timers);
    const report = healthReportSchema.parse(await response.json());
    expect(statusOf(report.indicators, 'database')).toBe('red');
    expect(calls).toEqual([DATABASE_TIMEOUT_MS]);
  });
});

describe('the probe is public and /health is not', () => {
  it('answers the probe as JSON even when html is accepted', async () => {
    const response = await getHealth(() => null, { accept: 'text/html' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(healthReportSchema.parse(await response.json()).commit).toBe(commit);
  });

  it('refuses /health itself without a principal', async () => {
    const { deps } = recordingDeps();
    const app = createApp({ ...deps, openDatabase: () => null });
    const unconfigured = await app.request('/health', {}, { COMMIT_SHA: commit });
    expect(unconfigured.status).toBe(503);
    const unsigned = await app.request('/health', {}, { ...fixtureAccessEnv, COMMIT_SHA: commit });
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toEqual({ status: 'error', reason: 'unauthenticated' });
  });
});

describe('FD-11 the overall status', () => {
  it('rolls indicators up to the worst status, ignoring unconfigured ones', () => {
    expect(overallStatus([indicator('ok'), indicator('not_configured'), indicator('amber')])).toBe(
      'amber',
    );
    expect(overallStatus([indicator('ok'), indicator('red'), indicator('amber')])).toBe('red');
    expect(overallStatus([indicator('not_wired')])).toBe('ok');
  });
});

describe('GL-1 the staging probe answers the database through Hyperdrive', () => {
  it('GL-1 the platform opens its database from the HYPERDRIVE binding and from nothing else', async () => {
    expect(platformDeps.openDatabase).toBe(hyperdriveDatabase);
    expect(hyperdriveDatabase({})).toBeNull();
    const bound = hyperdriveDatabase({
      HYPERDRIVE: { connectionString: 'postgres://unused@127.0.0.1:1/unused' },
    });
    expect(bound).not.toBeNull();
    await bound?.release();
  });

  it('GL-1 a database address without the HYPERDRIVE binding opens nothing', () => {
    const addressOnly: Bindings & { readonly DATABASE_URL: string } = {
      DATABASE_URL: 'postgres://unused@127.0.0.1:1/unused',
    };
    expect(hyperdriveDatabase(addressOnly)).toBeNull();
  });

  it('GL-1 the probe reports the database ok, with its latency, once the binding answers', async () => {
    const response = await getHealth(() => handleWithPing(answeringPing));
    expect(response.status).toBe(200);
    const report = healthReportSchema.parse(await response.json());
    const database = report.indicators.find((found) => found.name === 'database');
    expect(database).toMatchObject({
      status: 'ok',
      detail: expect.stringMatching(/^reachable in \d+ ms$/),
    });
  });
});
