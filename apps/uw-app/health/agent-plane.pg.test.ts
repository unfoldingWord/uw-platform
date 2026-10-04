import { beforeAll, describe, expect, it } from 'vitest';
import { healthReportSchema, type HealthIndicator } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { ghRepos, harnessRuns } from '@uw/db/schema';
import { seedGrant, seedHarness, seedItem, seedPerson } from '@uw/db/test-seed';
import { DEFAULT_SPEND_CAP, PLANE_LIMIT, type Clock, type PlaneTotals } from '@uw/harness';
import { createApp } from '../app.tsx';
import { platformKernel } from '../kernel.ts';
import {
  createAccessFixture,
  fixtureAccessEnv,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { AGENT_PLANE_INDICATORS, agentPlaneIndicators } from './agent-plane.ts';

const at = new Date('2026-10-15T12:00:00.000Z');
const clock: Clock = { now: () => at };
const HOUR = 3_600_000;
const HARNESS = '00000000-0000-4000-8000-000000005301';
const ITEM = '00000000-0000-4000-8000-000000005302';
const EDITOR = { id: '00000000-0000-4000-8000-000000005311', email: 'plane@unfoldingword.org' };
const PLATFORM = ['commit', 'database', 'queue', 'live_hub'];

let fixture: AccessFixture;

beforeAll(async () => {
  fixture = await createAccessFixture();
});

async function seed(db: Database): Promise<void> {
  await seedPerson(db, EDITOR);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000005312',
    personId: EDITOR.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  await seedHarness(db, { id: HARNESS, key: 'software', jdArea: '80-89' });
  await seedItem(db, {
    id: ITEM,
    harnessId: HARNESS,
    stageId: '00000000-0000-4000-8000-000000005303',
  });
}

async function meteredRun(db: Database, n: number, costMinor: number): Promise<void> {
  await db.insert(harnessRuns).values({
    id: `00000000-0000-4000-8000-00000000540${n}`,
    harnessId: HARNESS,
    itemId: ITEM,
    persona: 'agent:builder',
    delegationId: null,
    runShape: 'workflow-run',
    engine: 'claude-messages',
    model: 'claude-sonnet-5',
    costBasis: 'metered',
    costMinor,
    computeMinor: 0,
    traceId: '00000000-0000-4000-8000-000000005409',
    outcome: 'completed',
    startedAt: new Date(at.getTime() - n * HOUR),
    endedAt: new Date(at.getTime() - n * HOUR + 60_000),
  });
}

function indicatorsOn(db: Database, totals?: PlaneTotals) {
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  const kernel = platformKernel(handle, clock);
  const views = totals ? { ...kernel.views, planeTotals: async () => totals } : kernel.views;
  return agentPlaneIndicators({ kernel: { ...kernel, views }, db, at, cap: DEFAULT_SPEND_CAP });
}

function named(indicators: readonly HealthIndicator[], name: string): HealthIndicator {
  const found = indicators.find((indicator) => indicator.name === name);
  if (!found) throw new Error(`no indicator ${name}`);
  return found;
}

const cappedTotals: PlaneTotals = {
  at,
  spend: {
    meteredMinor: 0,
    computeMinor: 0,
    subscriptionTokens: 0,
    currency: 'USD',
    since: new Date('2026-10-01T00:00:00.000Z'),
  },
  runsToday: {
    byShape: { 'workflow-run': 3, 'external-run': 1 },
    byEngine: { external: 1, 'claude-messages': 3 },
    since: new Date('2026-10-15T00:00:00.000Z'),
  },
  liveDelegations: { count: 2, soonestExpiry: new Date(at.getTime() + 2 * HOUR) },
  gateRefusals: {
    byReason: { no_reviewer_approval: 2, gate_refused_to_agent: 4998 },
    capped: true,
  },
  agentWrites: { count: PLANE_LIMIT, capped: true },
  staleLearnings: { count: PLANE_LIMIT, capped: true },
};

async function statusesFollowTotals(db: Database): Promise<void> {
  await seed(db);
  await meteredRun(db, 1, 92_500);
  const low = await indicatorsOn(db);
  expect(low.map((indicator) => indicator.name)).toEqual([...AGENT_PLANE_INDICATORS]);
  expect(named(low, 'spend')).toEqual({
    name: 'spend',
    status: 'ok',
    detail: '$925.00 metered of $1,250.00 this month; 0 subscription tokens reported',
  });
  expect(named(low, 'breaker')).toMatchObject({ status: 'amber', detail: 'no fresh reading' });
  expect(named(low, 'live_delegations')).toEqual({
    name: 'live_delegations',
    status: 'ok',
    detail: 'None live',
  });
  await meteredRun(db, 2, 20_000);
  expect(named(await indicatorsOn(db), 'spend')).toMatchObject({ status: 'red' });
  const capped = await indicatorsOn(db, cappedTotals);
  expect(capped.map((indicator) => [indicator.name, indicator.status, indicator.detail])).toEqual([
    ['spend', 'ok', '$0.00 metered of $1,250.00 this month; 0 subscription tokens reported'],
    ['breaker', 'amber', 'no fresh reading'],
    ['runs_today', 'ok', '3 on the platform, 1 on own machines; claude-messages 3, external 1'],
    ['live_delegations', 'amber', '2 live; next expiry 2026-10-15 14:00 UTC'],
    [
      'gate_refusals_week',
      'amber',
      'at least 5,000 in 7 days; gate_refused_to_agent 4,998, no_reviewer_approval 2',
    ],
    ['agent_writes', 'amber', 'at least 5,000 events by agents in 24 hours'],
    ['stale_learnings', 'amber', 'at least 5,000 past their review date'],
    ['github_sweep', 'not_configured', 'No repositories installed'],
  ]);
}

type Repo = {
  readonly name: string;
  readonly sweptHoursAgo: number | null;
  readonly lastSweep: { readonly hoursAgo: number; readonly outcome: string } | null;
};

function hoursAgo(hours: number): Date {
  return new Date(at.getTime() - hours * HOUR);
}

async function sweepWith(db: Database, repos: readonly Repo[]): Promise<HealthIndicator> {
  await db.delete(ghRepos);
  for (const [n, repo] of repos.entries()) {
    const last = repo.lastSweep;
    await db.insert(ghRepos).values({
      githubId: 9_300_000 + n,
      fullName: `unfoldingWord/${repo.name}`,
      defaultBranch: 'main',
      private: false,
      sweptThrough: repo.sweptHoursAgo === null ? null : hoursAgo(repo.sweptHoursAgo),
      lastSweep:
        last === null
          ? null
          : { at: hoursAgo(last.hoursAgo).toISOString(), outcome: last.outcome, reason: null },
      freshAt: at,
    });
  }
  return named(await indicatorsOn(db), 'github_sweep');
}

function swept(name: string, outcome: string, hours = 1, behind = 0): Repo {
  return { name, sweptHoursAgo: hours + behind, lastSweep: { hoursAgo: hours, outcome } };
}

async function sweepStatuses(db: Database): Promise<void> {
  const fresh = swept('fresh', 'ok');
  expect(await sweepWith(db, [fresh])).toEqual({
    name: 'github_sweep',
    status: 'ok',
    detail: '1 repository; 1 ok',
  });
  expect(await sweepWith(db, [fresh, swept('broken', 'failed')])).toMatchObject({
    status: 'red',
    detail: '2 repositories; 1 ok, 1 failed',
  });
  expect(await sweepWith(db, [fresh, swept('old', 'ok', 49)])).toMatchObject({ status: 'red' });
  const never = { name: 'never', sweptHoursAgo: null, lastSweep: null };
  expect(await sweepWith(db, [fresh, never])).toMatchObject({
    status: 'red',
    detail: '2 repositories; 1 ok, 1 never swept',
  });
  for (const outcome of ['capped', 'deferred', 'stalled']) {
    expect(await sweepWith(db, [fresh, swept('held', outcome)])).toMatchObject({
      status: 'amber',
      detail: `2 repositories; 1 ok, 1 ${outcome}`,
    });
  }
  expect(await sweepWith(db, [fresh, swept('behind', 'ok', 1, 73)])).toMatchObject({
    status: 'amber',
    detail: '2 repositories; 1 ok, 1 more than 72 hours behind',
  });
}

async function sameAtOneInstant(db: Database): Promise<void> {
  await seed(db);
  await meteredRun(db, 1, 1_000);
  const app = createApp(postgresDeps(db, fixture, undefined, clock));
  const token = await fixture.sign({ email: EDITOR.email });
  const response = await app.request(
    '/health',
    { headers: { 'cf-access-jwt-assertion': token } },
    fixtureAccessEnv,
  );
  const screen = healthReportSchema.parse(await response.json());
  const mcpToken = await fixture.signForMcp({ email: EDITOR.email });
  const laptop = await httpClient(app, {
    'cf-access-jwt-assertion': mcpToken,
    'x-uw-device': 'laptop',
  });
  try {
    const { body } = await callTool(laptop, 'get_health', { harnessId: HARNESS });
    const verb = healthReportSchema.parse(body);
    expect(verb.indicators.map((indicator) => indicator.name)).toEqual([
      'harness',
      'database',
      ...AGENT_PLANE_INDICATORS,
    ]);
    expect(verb.indicators.slice(2)).toEqual(screen.indicators.slice(PLATFORM.length));
  } finally {
    await laptop.close();
  }
}

async function probeAndScreen(db: Database): Promise<void> {
  await seed(db);
  const app = createApp(postgresDeps(db, fixture, undefined, clock));
  const probe = await app.request('/health/probe', {}, fixtureAccessEnv);
  const report = healthReportSchema.parse(await probe.json());
  expect(report.indicators.map((indicator) => indicator.name)).toEqual(PLATFORM);
  const unsigned = await app.request('/health', {}, fixtureAccessEnv);
  expect(unsigned.status).toBe(401);
  const token = await fixture.sign({ email: EDITOR.email });
  const headers = { 'cf-access-jwt-assertion': token };
  const signed = await app.request('/health', { headers }, fixtureAccessEnv);
  const full = healthReportSchema.parse(await signed.json());
  expect(full.indicators.map((indicator) => indicator.name)).toEqual([
    ...PLATFORM,
    ...AGENT_PLANE_INDICATORS,
  ]);
  const html = await app.request(
    '/health',
    { headers: { ...headers, accept: 'text/html' } },
    fixtureAccessEnv,
  );
  expect(html.headers.get('content-type')).toContain('text/html');
  expect(await html.text()).toContain('github_sweep');
}

describe.skipIf(!testServer)('the agent plane indicators', () => {
  it("WB-10 each indicator's status and detail follow its totals", () =>
    withAppDatabase(statusesFollowTotals));
  it('WB-10 the GitHub sweep indicator is red for a failed or stale sweep and amber for a capped, deferred or stalled one', () =>
    withAppDatabase(sweepStatuses));
  it('WB-10 get_health answers the same agent-plane indicators as /health at one instant', () =>
    withAppDatabase(sameAtOneInstant));
  it('/health/probe answers the platform indicators without a principal, and /health needs one', () =>
    withAppDatabase(probeAndScreen));
});
