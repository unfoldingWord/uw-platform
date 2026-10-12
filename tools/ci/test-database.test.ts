import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = { name?: string; run?: string; env?: Record<string, string> };
type Service = { image?: string; env?: Record<string, string>; ports?: string[]; options?: string };
type Job = { env?: Record<string, string>; services?: Record<string, Service>; steps?: Step[] };

const ci: { jobs: Record<string, Job> } = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const testJob = ci.jobs['test'] ?? {};
const serviceUrl = 'postgres://postgres@127.0.0.1:5432/postgres';

describe('FD-6 the CI test job runs on a real Postgres', () => {
  it('starts a postgres:16 service container that needs no password', () => {
    const postgres = testJob.services?.['postgres'];
    expect(postgres?.image).toBe('postgres:16');
    expect(postgres?.env?.['POSTGRES_HOST_AUTH_METHOD']).toBe('trust');
    expect(postgres?.ports).toEqual(['5432:5432']);
    expect(postgres?.options).toContain('--health-cmd pg_isready');
  });

  it('points TEST_DATABASE_URL at the service container', () => {
    expect(testJob.env?.['TEST_DATABASE_URL']).toBe(serviceUrl);
  });

  it('applies every migration from empty, re-applies them, then runs the tests', () => {
    const runs = (testJob.steps ?? []).map((step) => step.run ?? '');
    const migrate = runs.flatMap((run, index) => (run === 'pnpm db:migrate' ? [index] : []));
    const test = runs.indexOf('pnpm test');
    expect(migrate).toHaveLength(2);
    expect(test).toBeGreaterThan(Math.max(...migrate));
    const migrateEnv = (testJob.steps ?? []).filter((step) => step.run === 'pnpm db:migrate');
    expect(migrateEnv.every((step) => step.env?.['DATABASE_URL'] === serviceUrl)).toBe(true);
  });

  it('references no secret', () => {
    expect(JSON.stringify(testJob)).not.toMatch(/secrets/);
  });
});

describe.skipIf(process.env['CI'] !== 'true')('FD-6 database tests never skip in CI', () => {
  it('has TEST_DATABASE_URL set wherever CI runs the tests', () => {
    expect(process.env['TEST_DATABASE_URL']).toMatch(/^postgres:\/\//);
  });
});
