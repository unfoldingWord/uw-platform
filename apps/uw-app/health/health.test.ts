import { describe, expect, it } from 'vitest';
import { healthReportSchema, type HealthIndicator } from '@uw/contracts';
import { createApp } from '../app.tsx';
import type { DatabaseHandle } from '../database.ts';
import { recordingDeps } from '../testing/deps.ts';
import { DATABASE_TIMEOUT_MS, overallStatus } from './indicators.ts';

const commit = '0123456789abcdef0123456789abcdef01234567';

function handleWithPing(ping: () => Promise<void>): DatabaseHandle {
  return { db: {} as never, ping, release: async () => undefined };
}

async function getHealth(openDatabase: () => DatabaseHandle | null, headers: HeadersInit = {}) {
  const { deps } = recordingDeps();
  return createApp({ ...deps, openDatabase }).request(
    '/health',
    { headers },
    { COMMIT_SHA: commit },
  );
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
  it('reports ok with the database and queue not configured when nothing is bound', async () => {
    const response = await getHealth(() => null);
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).toContain(`"commit":"${commit}"`);
    const report = healthReportSchema.parse(JSON.parse(raw));
    expect(report.status).toBe('ok');
    expect(report.indicators.map((i) => i.name)).toEqual(['commit', 'database', 'queue']);
    expect(statusOf(report.indicators, 'commit')).toBe('ok');
    expect(statusOf(report.indicators, 'database')).toBe('not_configured');
    expect(statusOf(report.indicators, 'queue')).toBe('not_configured');
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

  it('turns the database red within the timeout when it never answers', async () => {
    const started = Date.now();
    const response = await getHealth(() => handleWithPing(neverPing));
    expect(Date.now() - started).toBeLessThan(DATABASE_TIMEOUT_MS + 1000);
    const report = healthReportSchema.parse(await response.json());
    expect(statusOf(report.indicators, 'database')).toBe('red');
  });

  it('renders a screen when html is accepted', async () => {
    const response = await getHealth(() => null, { accept: 'text/html' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('<h1>Health</h1>');
    expect(html).toContain('database');
    expect(html).toContain('not_configured');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|style=/i);
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
