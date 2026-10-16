import { beforeAll, describe, expect, it } from 'vitest';
import { healthReportSchema, type HealthIndicator } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { ghRepos, harnessRuns } from '@uw/db/schema';
import {
  seedBreakerReading,
  seedGrant,
  seedHarness,
  seedItem,
  seedPage,
  seedPerson,
} from '@uw/db/test-seed';
import { DEFAULT_SPEND_CAP, PLANE_LIMIT, type Clock, type PlaneTotals } from '@uw/harness';
import { createApp } from '../app.tsx';
import { platformKernel } from '../kernel.ts';
import {
  createAccessFixture,
  fixtureAccessEnv,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { personOn } from '../testing/kernel.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { AGENT_PLANE_INDICATORS, agentPlaneIndicators } from './agent-plane.ts';

const at = new Date('2026-10-15T12:00:00.000Z');
const clock: Clock = { now: () => at };
const HOUR = 3_600_000;
const HARNESS = '00000000-0000-4000-8000-000000005301';
const OTHER = '00000000-0000-4000-8000-000000005399';
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

async function indicatorsOn(db: Database, totals?: PlaneTotals) {
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  const kernel = platformKernel(handle, clock);
  const views = totals ? { ...kernel.views, planeTotals: async () => totals } : kernel.views;
  const caller = { actor: await personOn(db, EDITOR.id, EDITOR.email, at), traceId: ITEM };
  const source = { kernel: { ...kernel, views }, caller, db, at, cap: DEFAULT_SPEND_CAP };
  return agentPlaneIndicators(source);
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
  liveDelegations: { count: 2, merge: 0, soonestExpiry: new Date(at.getTime() + 2 * HOUR) },
  gateRefusals: {
    byReason: { no_reviewer_approval: 2, gate_refused_to_agent: 4998 },
    capped: true,
  },
  agentWrites: { count: PLANE_LIMIT, capped: true },
  staleLearnings: { count: PLANE_LIMIT, capped: true },
  reviewerRefutes: {
    tallies: [
      {
        harnessId: HARNESS,
        harnessKey: 'software',
        persona: 'agent:reviewer',
        findings: 8,
        refuted: 2,
      },
      {
        harnessId: HARNESS,
        harnessKey: 'software',
        persona: 'agent:reviewer-codex',
        findings: 3,
        refuted: 0,
      },
      {
        harnessId: OTHER,
        harnessKey: 'courses',
        persona: 'agent:reviewer',
        findings: 4,
        refuted: 1,
      },
    ],
    capped: true,
  },
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
  await meteredRun(db, 3, 1_250);
  expect(named(await indicatorsOn(db), 'spend')).toEqual({
    name: 'spend',
    status: 'amber',
    detail: '$937.50 metered of $1,250.00 this month; 0 subscription tokens reported',
  });
  await meteredRun(db, 4, 17_500);
  expect(named(await indicatorsOn(db), 'spend')).toMatchObject({ status: 'amber' });
  await meteredRun(db, 2, 1_250);
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
    [
      'reviewer_refutes',
      'amber',
      'Refuted findings in 30 days; agent:reviewer on software 2 of 8 refuted, agent:reviewer-codex on software 0 of 3 refuted, agent:reviewer on courses 1 of 4 refuted',
    ],
    ['silence_alarm', 'ok', 'No item has waited in Check over 45 minutes without a review step'],
    ['held_by_person', 'ok', 'None over 24 hours'],
    ['held_by_agent', 'ok', 'None over 2 hours'],
  ]);
}

async function noRefutesYet(db: Database): Promise<void> {
  await seed(db);
  expect(named(await indicatorsOn(db), 'reviewer_refutes')).toEqual({
    name: 'reviewer_refutes',
    status: 'ok',
    detail: 'No Reviewer findings in 30 days',
  });
}

async function breakerAndCap(db: Database): Promise<void> {
  await seed(db);
  const stale = new Date(at.getTime() - 11 * 60_000);
  await seedBreakerReading(db, {
    harnessId: HARNESS,
    at: stale,
    actor: 'agent:system',
    percent: 10,
  });
  const old = await indicatorsOn(db);
  expect(named(old, 'breaker')).toEqual({
    name: 'breaker',
    status: 'amber',
    detail: 'no fresh reading',
  });
  expect(named(old, 'spend').detail).not.toContain('breaker');
  await seedBreakerReading(db, {
    harnessId: HARNESS,
    at,
    actor: 'agent:system',
    name: 'breaker_holding',
    percent: 80,
  });
  const fresh = await indicatorsOn(db);
  expect(named(fresh, 'breaker')).toEqual({
    name: 'breaker',
    status: 'amber',
    detail: '80 percent of $1,250.00 spent',
  });
  expect(named(fresh, 'spend').detail).toContain('the breaker reads 80 percent');
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
  expect(signed.headers.get('cache-control')).toBe('no-store');
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

async function mergeDelegationsNamed(db: Database): Promise<void> {
  await seed(db);
  const liveDelegations = { ...cappedTotals.liveDelegations, merge: 1 };
  expect(
    named(await indicatorsOn(db, { ...cappedTotals, liveDelegations }), 'live_delegations'),
  ).toEqual({
    name: 'live_delegations',
    status: 'amber',
    detail: '2 live, 1 of them merge; next expiry 2026-10-15 14:00 UTC',
  });
}

describe.skipIf(!testServer)('the agent plane indicators', () => {
  it("WB-10 each indicator's status and detail follow its totals", () =>
    withAppDatabase(statusesFollowTotals));
  it('MD-6 the live delegations indicator says how many of them are merge delegations', () =>
    withAppDatabase(mergeDelegationsNamed));
  it('RV-2 the Reviewer refute rate reads no findings on a plane with no Reviewer run', () =>
    withAppDatabase(noRefutesYet));
  it('WB-10 the breaker indicator shows its state against the cap, and spend names the breaker only while its reading is fresh', () =>
    withAppDatabase(breakerAndCap));
  it('WB-10 the GitHub sweep indicator is red for a failed or stale sweep and amber for a capped, deferred or stalled one', () =>
    withAppDatabase(sweepStatuses));
  it('WB-10 get_health answers the same agent-plane indicators as /health at one instant', () =>
    withAppDatabase(sameAtOneInstant));
  it('/health/probe answers the platform indicators without a principal, and /health needs one', () =>
    withAppDatabase(probeAndScreen));
});

const learningSeeds: readonly [string, string, string, Record<string, unknown>][] = [
  ['Assumed since July', '80-89', 'active', { confidence: 'assumed', as_of: '2026-07-01' }],
  ['Inferred in August', '80-89', 'suggested', { confidence: 'inferred', as_of: '2026-08-01' }],
  ['Observed', '80-89', 'active', { confidence: 'observed', review_by: '2026-09-01' }],
  ['Due this month', '80-89', 'active', { confidence: 'inferred', review_by: '2026-10-01' }],
  ['Elsewhere', '20-29', 'active', { confidence: 'assumed', review_by: '2026-09-01' }],
  ['Retired', '80-89', 'retired', { confidence: 'assumed', review_by: '2026-09-01' }],
];

async function seedLearnings(db: Database): Promise<void> {
  await seed(db);
  for (const [index, [title, jdArea, status, frontmatter]] of learningSeeds.entries()) {
    await seedPage(db, {
      id: `00000000-0000-4000-8000-0000000055a${index}`,
      type: 'learning',
      status: status === 'retired' ? 'retired' : status === 'active' ? 'active' : 'suggested',
      jdArea,
      slug: `stale-${index}`,
      title,
      bodyMd: 'What we think.',
      frontmatter: { as_of: '2026-06-01', supersedes: [], review_by: null, ...frontmatter },
    });
  }
}

const VIEWER = {
  id: '00000000-0000-4000-8000-000000005313',
  email: 'plane-viewer@unfoldingword.org',
};

async function seedViewer(db: Database): Promise<void> {
  await seedPerson(db, VIEWER);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000005314',
    personId: VIEWER.id,
    role: 'viewer',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
}

async function staleRows(db: Database, person = EDITOR) {
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  const actor = await personOn(db, person.id, person.email, at);
  const caller = { actor, traceId: crypto.randomUUID(), requestId: null };
  const rows = await platformKernel(handle, clock).views.planeList(caller, 'stale_learnings', {
    at,
  });
  return rows.map((row) => row.cells);
}

async function staleReport(db: Database): Promise<void> {
  await seedLearnings(db);
  const rows = await staleRows(db);
  expect(rows).toEqual(
    expect.arrayContaining([
      { title: 'Assumed since July', confidence: 'assumed', 'review by': '2026-09-29' },
      { title: 'Due this month', confidence: 'inferred', 'review by': '2026-10-01' },
      { title: 'Elsewhere', confidence: 'assumed', 'review by': '2026-09-01' },
    ]),
  );
  expect(rows.map((row) => row['title'])).not.toEqual(
    expect.arrayContaining(['Inferred in August']),
  );
  expect(rows).toHaveLength(3);
}

async function staleReadable(db: Database): Promise<void> {
  await seedLearnings(db);
  await seedViewer(db);
  const titles = (await staleRows(db, VIEWER)).map((row) => row['title']);
  expect(titles.toSorted()).toEqual(['Assumed since July', 'Due this month']);
  expect(named(await indicatorsOn(db), 'stale_learnings')).toMatchObject({
    detail: '3 past their review date',
  });
}

async function staleIndicators(db: Database): Promise<void> {
  await seedLearnings(db);
  const app = createApp(postgresDeps(db, fixture, undefined, clock));
  const token = await fixture.sign({ email: EDITOR.email });
  const response = await app.request(
    '/health',
    { headers: { 'cf-access-jwt-assertion': token } },
    fixtureAccessEnv,
  );
  const screen = named(
    healthReportSchema.parse(await response.json()).indicators,
    'stale_learnings',
  );
  expect(screen).toEqual({
    name: 'stale_learnings',
    status: 'amber',
    detail: '3 past their review date',
  });
  const mcpToken = await fixture.signForMcp({ email: EDITOR.email });
  const laptop = await httpClient(app, {
    'cf-access-jwt-assertion': mcpToken,
    'x-uw-device': 'laptop',
  });
  try {
    const { body } = await callTool(laptop, 'get_health', { harnessId: HARNESS });
    expect(named(healthReportSchema.parse(body).indicators, 'stale_learnings')).toEqual(screen);
  } finally {
    await laptop.close();
  }
}

describe.skipIf(!testServer)('stale learnings', () => {
  it('PE-8 the stale-confidence report lists assumed and inferred learnings past their review date, defaulting to 90 days after as_of', () =>
    withAppDatabase(staleReport));
  it('PE-8 the report shows only learnings the caller may read', () =>
    withAppDatabase(staleReadable));
  it('PE-8 the stale_learnings indicator counts them on get_health and on /health', () =>
    withAppDatabase(staleIndicators));
});
