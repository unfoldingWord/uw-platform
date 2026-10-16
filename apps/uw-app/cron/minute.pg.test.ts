import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { HarnessEvent } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase } from '@uw/db/test-database';
import { projectSeededPersona, seedPage } from '@uw/db/test-seed';
import type { EngineConfig, EngineFetch } from '../engines/config.ts';
import type { Bindings } from '../env.ts';
import { fakeWorkflowBinding } from '../runs/testing.ts';
import { agentOf, kernelOn } from '../testing/kernel.ts';
import { testServer } from '../testing/postgres.ts';
import {
  accepted,
  allEvents,
  callerOf,
  enqueued,
  ian,
  softwareHarness,
} from '../testing/commands.ts';
import type { CronDeps } from './job.ts';
import { minuteJob } from './minute.ts';

type Line = Record<string, unknown>;

type Rig = {
  readonly db: Database;
  readonly env: Bindings;
  readonly harnessId: string;
  readonly lines: Line[];
  readonly clock: { offset: number };
};

const PERSONA_PAGE = '00000000-0000-4000-8000-000000009701';
const MINUTE = 60_000;

function costReply(cost: number): Response {
  const groups = [{ count: 1, sum: { cost } }];
  const body = { data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: groups }] } } };
  return Response.json(body);
}

function engines(fetch: EngineFetch, cap: string | undefined): EngineConfig {
  return {
    AI_GATEWAY_ACCOUNT_ID: 'account',
    AI_GATEWAY_ID: 'gateway',
    AI_GATEWAY_ANALYTICS_TOKEN: 'analytics',
    AI_SPEND_CAP_MINOR: cap,
    fetch,
  };
}

function depsOf(rig: Rig, spend: EngineFetch, cap?: string): CronDeps {
  return {
    now: () => new Date(Date.now() + rig.clock.offset),
    fetch: () => Promise.reject(new Error('the minute job sends no request but the spend read')),
    sink: (line) => rig.lines.push(JSON.parse(line) as Line),
    newId: () => randomUUID(),
    commit: 'c',
    engines: engines(spend, cap),
  };
}

async function withRig(work: (rig: Rig) => Promise<void>): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  try {
    const { harnessId } = await softwareHarness(db);
    const env: Bindings = { HYPERDRIVE: { connectionString: database.connectionString } };
    await work({ db, env, harnessId, lines: [], clock: { offset: 0 } });
  } finally {
    await db.$client.end();
    await database.drop();
  }
}

async function agentItem(rig: Rig, title: string): Promise<string> {
  const admin = await ian(rig.db);
  const kernel = kernelOn(rig.db, { now: () => new Date() });
  const { harnessId } = rig;
  const change = { agentPickup: 'allowed' as const, bracket: 'build_package' as const };
  accepted(
    await kernel.stages.updateStage(callerOf(admin), { harnessId, stageKey: 'package', change }),
  );
  return enqueued(rig.db, harnessId, title);
}

async function delegatedPersona(rig: Rig): Promise<string> {
  const admin = await ian(rig.db);
  const kernel = kernelOn(rig.db, { now: () => new Date() });
  const { harnessId } = rig;
  const itemId = await agentItem(rig, 'Run the minute beat');
  accepted(
    await kernel.delegations.grant(callerOf(admin), {
      maxTier: null,
      harnessId,
      persona: 'agent:builder',
      capability: 'build',
      expiresAt: null,
      supersedes: null,
    }),
  );
  await seedPage(rig.db, {
    id: PERSONA_PAGE,
    type: 'persona',
    status: 'active',
    jdArea: '80-89',
    slug: 'builder',
    title: 'Builder',
    bodyMd: 'Builder turns an approved plan into commits.',
    frontmatter: {
      identity: 'agent:builder',
      owner: admin.identity,
      harness: harnessId,
      toolset: ['read_page', 'record_run_step', 'submit_to_gate'],
      run_shape: 'workflow-run',
      engine: 'claude-messages',
      model: 'claude-sonnet-5',
      provider: null,
      budget: { monthly_minor: 0, currency: 'USD' },
      capability: 'build',
      requires_tools: [],
    },
  });
  await projectSeededPersona(rig.db, PERSONA_PAGE);
  return itemId;
}

function outcomeOf(rig: Rig, route: string): Line | undefined {
  return rig.lines.find((line) => line['route'] === 'cron minute' && line['step'] === route);
}

async function named(rig: Rig, name: string): Promise<HarnessEvent[]> {
  return (await allEvents(rig.db, rig.harnessId)).filter((event) => event.name === name);
}

async function checksTheCap(rig: Rig): Promise<void> {
  await minuteJob(
    rig.env,
    depsOf(rig, () => Promise.resolve(costReply(12.5)), '1500'),
  );
  expect(outcomeOf(rig, 'breaker')).toMatchObject({
    outcome: 'breaker_checked',
    breaker_level: 'holding',
    percent: 83,
    principal: 'agent:system',
  });
  const [holding] = await named(rig, 'breaker_holding');
  expect(holding?.evidence).toEqual({
    spentMinor: 1250,
    capMinor: 1500,
    currency: 'USD',
    percent: 83,
  });
  expect(holding?.actor).toBe('agent:system');
}

async function unreadableSpend(rig: Rig): Promise<void> {
  await delegatedPersona(rig);
  const failing = () => Promise.resolve(new Response('down', { status: 503 }));
  await minuteJob(rig.env, depsOf(rig, failing));
  expect(outcomeOf(rig, 'breaker')).toMatchObject({
    outcome: 'breaker_unreadable',
    error_name: 'SpendUnreadableError',
  });
  expect(outcomeOf(rig, 'sweep')).toMatchObject({ outcome: 'leases_swept', expired: 0 });
  expect(outcomeOf(rig, 'beat')).toMatchObject({
    outcome: 'beat_finished',
    started: 0,
    skipped: 1,
  });
  expect(await named(rig, 'breaker_open')).toEqual([]);
  const unwired = { ...depsOf(rig, failing), engines: { fetch: failing } };
  await minuteJob(rig.env, unwired);
  expect(rig.lines.filter((line) => line['step'] === 'breaker').at(-1)).toMatchObject({
    outcome: 'breaker_not_configured',
  });
}

async function beatsAsSystem(rig: Rig): Promise<void> {
  const itemId = await delegatedPersona(rig);
  const binding = fakeWorkflowBinding();
  const env: Bindings = { ...rig.env, HARNESS_RUN: binding };
  await minuteJob(
    env,
    depsOf(rig, () => Promise.resolve(costReply(0))),
  );
  expect(outcomeOf(rig, 'beat')).toMatchObject({
    outcome: 'beat_finished',
    principal: 'agent:system',
    started: 1,
    skipped: 0,
  });
  const [started] = await named(rig, 'run_started');
  expect(started).toMatchObject({ itemId, actor: 'agent:builder' });
  const runId = String(started?.evidence['runId']);
  expect(binding.instances.get(runId)?.params).toMatchObject({
    runId,
    itemId,
    persona: 'agent:builder',
  });
  await minuteJob(
    env,
    depsOf(rig, () => Promise.resolve(costReply(0))),
  );
  expect(binding.instances.size).toBe(1);
}

async function startFailsUnbound(rig: Rig): Promise<void> {
  const itemId = await delegatedPersona(rig);
  await minuteJob(
    rig.env,
    depsOf(rig, () => Promise.resolve(costReply(0))),
  );
  expect(outcomeOf(rig, 'beat')).toMatchObject({
    outcome: 'beat_finished',
    started: 0,
    skipped: 1,
  });
  const runs = (await allEvents(rig.db, rig.harnessId)).filter(
    (event) => event.itemId === itemId && event.name.startsWith('run_'),
  );
  expect(runs.map((event) => event.name)).toEqual(['run_started', 'run_failed']);
  expect(runs[1]?.evidence).toMatchObject({ why: 'start_failed', detail: 'PortNotWiredError' });
}

async function sweepsLapsedLease(rig: Rig): Promise<void> {
  const laptop = agentOf(await ian(rig.db), 'laptop');
  const kernel = kernelOn(rig.db, { now: () => new Date() });
  const itemId = await agentItem(rig, 'A lease that lapses');
  accepted(await kernel.items.claim(callerOf(laptop), { itemId, delegationId: null }));
  rig.clock.offset = 16 * MINUTE;
  await minuteJob(
    rig.env,
    depsOf(rig, () => Promise.resolve(costReply(0))),
  );
  expect(outcomeOf(rig, 'sweep')).toMatchObject({ outcome: 'leases_swept', expired: 1 });
  const expired = await named(rig, 'lease_expired');
  expect(expired.map((event) => event.itemId)).toEqual([itemId]);
  rig.lines.length = 0;
  await minuteJob(
    rig.env,
    depsOf(rig, () => Promise.resolve(costReply(0))),
  );
  expect(outcomeOf(rig, 'sweep')).toMatchObject({ outcome: 'leases_swept', expired: 0 });
}

async function delegatedExitsWithoutApp(rig: Rig): Promise<void> {
  await minuteJob(
    rig.env,
    depsOf(rig, () => Promise.resolve(costReply(0))),
  );
  expect(outcomeOf(rig, 'beat')).toMatchObject({ outcome: 'beat_finished' });
  expect(outcomeOf(rig, 'delegated_exits')).toMatchObject({ outcome: 'github_not_configured' });
}

async function lapsesExpiredDelegation(rig: Rig): Promise<void> {
  const admin = await ian(rig.db);
  const kernel = kernelOn(rig.db, { now: () => new Date() });
  const expiresAt = new Date(Date.now() + 5 * MINUTE);
  const granted = accepted(
    await kernel.delegations.grant(callerOf(admin), {
      maxTier: null,
      harnessId: rig.harnessId,
      persona: 'agent:builder',
      capability: 'build',
      expiresAt,
      supersedes: null,
    }),
  );
  const spend = () => Promise.resolve(costReply(0));
  await minuteJob(rig.env, depsOf(rig, spend));
  expect(outcomeOf(rig, 'expiry')).toMatchObject({ outcome: 'delegations_lapsed', lapsed: 0 });
  rig.lines.length = 0;
  rig.clock.offset = 6 * MINUTE;
  await minuteJob(rig.env, depsOf(rig, spend));
  expect(outcomeOf(rig, 'expiry')).toMatchObject({ outcome: 'delegations_lapsed', lapsed: 1 });
  const lapsed = await named(rig, 'delegation_lapsed');
  expect(lapsed.map((event) => [event.evidence, event.actor])).toEqual([
    [{ delegationId: granted.id, why: 'expired' }, 'agent:system'],
  ]);
}

describe.skipIf(!testServer)('the minute cron', () => {
  it('HE-5 the minute cron checks the breaker against the configured cap', () =>
    withRig(checksTheCap));

  it('HE-5 an unreadable spend is logged and the sweep and the beat still run', () =>
    withRig(unreadableSpend));

  it('HE-1 the minute cron runs the hosted beat as the system principal', () =>
    withRig(beatsAsSystem));

  it('the lease sweep expires a lapsed lease once a minute', () => withRig(sweepsLapsedLease));
  it('the minute cron records the lapse of a delegation once it expires', () =>
    withRig(lapsesExpiredDelegation));

  it('MD-3 after the beat the minute cron runs the delegated exits, and without the GitHub App it says so', () =>
    withRig(delegatedExitsWithoutApp));

  it('a beat start without the Workflow binding fails start_failed and releases the item', () =>
    withRig(startFailsUnbound));
});
