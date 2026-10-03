import { afterAll, describe, expect, it } from 'vitest';
import { newEventSchema, type Principal } from '@uw/contracts';
import { createClient } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import { createApp } from '../app.tsx';
import { platformStore } from '../ports/store.ts';
import { createAccessFixture } from '../testing/access-keys.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps } from '../testing/postgres.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const EDITOR = {
  id: '00000000-0000-4000-8000-000000001401',
  email: 'runs-editor@unfoldingword.org',
};

type Body = Record<string, unknown>;

const dropped: (() => Promise<void>)[] = [];

afterAll(async () => {
  for (const drop of dropped) await drop();
});

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function openRig() {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  dropped.push(async () => {
    await db.$client.end();
    await database.drop();
  });
  let current = Date.now();
  const clock = { now: () => new Date(current), advance: (ms: number) => void (current += ms) };
  await seedPerson(db, EDITOR);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000001402',
    personId: EDITOR.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  const ian = await personOn(db, IAN_ID, 'ian.lindsley@unfoldingword.org', clock.now());
  const fixture = await createAccessFixture();
  return { db, clock, fixture, ian, kernel: kernelOn(db, clock) };
}

type Rig = Awaited<ReturnType<typeof openRig>>;

async function itemOn(r: Rig): Promise<{ readonly harnessId: string; readonly itemId: string }> {
  const harnessId = crypto.randomUUID();
  const as = caller(r.ian);
  value(
    await r.kernel.stages.activate(as, {
      harnessId,
      harnessKey: 'software-runs',
      jdArea: '80-89',
      template: software,
      repository: 'unfoldingWord/software-runs',
    }),
  );
  const change = { agentPickup: 'allowed' as const };
  value(await r.kernel.stages.updateStage(as, { harnessId, stageKey: 'package', change }));
  const input = { harnessId, title: 'Run it', pageId: null, priority: 1, due: null };
  const item = value(await r.kernel.items.enqueue(as, { ...input, delegationId: null }));
  return { harnessId, itemId: item.itemId };
}

async function queuePrompt(r: Rig, runId: string, prompt: string): Promise<void> {
  await platformStore(r.db).transaction(async (tx) => {
    const run = await tx.harnessRuns.read.lock(runId);
    if (run === null) throw new Error(`no run ${runId}`);
    await tx.harnessRuns.write.update({ ...run, prompts: [...run.prompts, prompt] });
  });
}

async function externalRun(): Promise<void> {
  const r = await openRig();
  const { harnessId, itemId } = await itemOn(r);
  const token = await r.fixture.signForMcp({ email: EDITOR.email });
  const app = createApp(postgresDeps(r.db, r.fixture, undefined, r.clock));
  const laptop = await httpClient(app, {
    'cf-access-jwt-assertion': token,
    'x-uw-device': 'laptop',
  });
  const runId = crypto.randomUUID();
  const step = async (): Promise<Body> => {
    const args = { itemId, runId, step: 'work', tokensIn: 90, tokensOut: 10, model: 'opus' };
    return (await callTool(laptop, 'record_run_step', { ...args, costBasis: 'subscription' })).body;
  };
  try {
    expect((await callTool(laptop, 'claim_item', { itemId, delegationId: null })).isError).toBe(
      false,
    );
    expect((await step())['prompts']).toEqual([]);
    await queuePrompt(r, runId, 'Rebase on main first.');
    expect(await step()).toEqual({
      leaseExpiresAt: expect.any(String),
      leaseWarning: false,
      prompts: ['Rebase on main first.'],
    });
    expect((await step())['prompts']).toEqual([]);
  } finally {
    await laptop.close();
  }
  const run = await platformStore(r.db).transaction((tx) => tx.harnessRuns.read.byId(runId));
  expect(run).toMatchObject({
    itemId,
    persona: `agent:${EDITOR.id}/laptop`,
    runShape: 'external-run',
    engine: 'external',
    model: 'opus',
    costBasis: 'subscription',
    costMinor: null,
    computeMinor: null,
    outcome: 'running',
    prompts: [],
  });
  expect(run?.steps).toHaveLength(3);
  const events = await platformStore(r.db).transaction((tx) =>
    readAllEvents(tx, harnessId, itemId),
  );
  expect(events.filter((event) => event.name === 'run_started')).toHaveLength(1);
  expect(events.filter((event) => event.name === 'run_step_recorded')).toHaveLength(3);
}

async function seedReading(
  r: Rig,
  harnessId: string,
  reading: { readonly name: 'breaker_open' | 'breaker_holding'; readonly percent: number },
): Promise<void> {
  await platformStore(r.db).transaction((tx) =>
    tx.harnessEvents.write.append([
      newEventSchema.parse({
        eventId: crypto.randomUUID(),
        harnessId,
        itemId: null,
        name: reading.name,
        at: r.clock.now().toISOString(),
        actor: 'agent:system',
        evidence: {
          spentMinor: reading.percent * 1250,
          capMinor: 125_000,
          currency: 'USD',
          percent: reading.percent,
        },
        traceId: crypto.randomUUID(),
        requestId: null,
      }),
    ]),
  );
}

async function breakerHealth(): Promise<void> {
  const r = await openRig();
  const { harnessId } = await itemOn(r);
  const token = await r.fixture.signForMcp({ email: EDITOR.email });
  const app = createApp(postgresDeps(r.db, r.fixture, undefined, r.clock));
  const laptop = await httpClient(app, {
    'cf-access-jwt-assertion': token,
    'x-uw-device': 'laptop',
  });
  const breaker = async () => {
    const { body } = await callTool(laptop, 'get_health', { harnessId });
    const indicators = body['indicators'] as readonly Body[];
    return indicators.find((indicator) => indicator['name'] === 'breaker');
  };
  try {
    expect(await breaker()).toEqual({
      name: 'breaker',
      status: 'amber',
      detail: 'no fresh reading',
    });
    await seedReading(r, harnessId, { name: 'breaker_open', percent: 10 });
    expect(await breaker()).toEqual({
      name: 'breaker',
      status: 'ok',
      detail: '10 percent of the cap spent',
    });
    r.clock.advance(11 * 60_000);
    expect(await breaker()).toEqual({
      name: 'breaker',
      status: 'amber',
      detail: 'no fresh reading',
    });
    await seedReading(r, harnessId, { name: 'breaker_holding', percent: 80 });
    expect(await breaker()).toEqual({
      name: 'breaker',
      status: 'amber',
      detail: '80 percent of the cap spent',
    });
  } finally {
    await laptop.close();
  }
}

describe.skipIf(!testServer)('record_run_step from an external runner', () => {
  it('HE-6 record_run_step over HTTP answers prompts and creates the external run', externalRun);

  it('HE-5 get_health shows the breaker as an indicator', breakerHealth);
});
