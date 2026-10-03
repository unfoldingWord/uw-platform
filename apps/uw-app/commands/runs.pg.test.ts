import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedBreakerReading, seedHostedRun } from '@uw/db/test-seed';
import type { Caller } from '@uw/harness';
import { platformRuns } from '../ports/runs.ts';
import { platformStore } from '../ports/store.ts';
import { fakeWorkflowBinding } from '../runs/testing.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  accepted,
  callerOf,
  command,
  dispatchAs,
  dispatchScope,
  enqueued,
  eventCount,
  eventsNamed,
  ian,
  itemState,
  softwareHarness,
  type Scene,
} from '../testing/commands.ts';

type Hosted = Scene & {
  readonly admin: Principal;
  readonly itemId: string;
  readonly runId: string;
  readonly beat: Caller;
};

const IAN_EMAIL = 'ian.lindsley@unfoldingword.org';

function personaOf(admin: Principal): Principal {
  return principalSchema.parse({
    identity: 'agent:builder',
    kind: 'agent',
    personId: admin.personId,
    email: null,
    grants: [],
    interactive: false,
  });
}

async function hostedRun(db: Database): Promise<Hosted> {
  const scene = await softwareHarness(db);
  const admin = await ian(db);
  const kernel = kernelOn(db, { now: () => new Date() });
  const as = callerOf(admin);
  const change = { agentPickup: 'allowed' as const };
  const { harnessId } = scene;
  accepted(await kernel.stages.updateStage(as, { harnessId, stageKey: 'package', change }));
  const itemId = await enqueued(db, harnessId, 'Run the board');
  const delegation = accepted(
    await kernel.delegations.grant(as, {
      harnessId,
      persona: 'agent:builder',
      capability: 'build',
      expiresAt: null,
      supersedes: null,
    }),
  );
  const beat = accepted(
    await kernel.delegations.beat(callerOf(personaOf(admin)), { delegationId: delegation.id }),
  );
  const beatCaller = callerOf(beat.principal);
  await seedBreakerReading(db, { harnessId, at: new Date(), actor: 'agent:system' });
  accepted(await kernel.items.claim(beatCaller, { itemId, delegationId: delegation.id }));
  const runId = randomUUID();
  const run = { id: runId, harnessId, itemId, delegationId: delegation.id };
  await seedHostedRun(db, { ...run, persona: 'agent:builder' });
  return { ...scene, admin, itemId, runId, beat: beatCaller };
}

function runOf(db: Database, runId: string) {
  return platformStore(db).transaction((tx) => tx.harnessRuns.read.byId(runId));
}

function send(db: Database, email: string, scene: Hosted, name: string, extra = {}) {
  const requestId = randomUUID();
  const body = { requestId, itemId: scene.itemId, ...extra };
  return command(db, { email }, scene.harnessId, name, body);
}

async function hostedBuilderSwitch(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const requestId = randomUUID();
  const body = { requestId, enabled: true };
  const byEditor = await command(db, scene.editor, scene.harnessId, 'set_hosted_builder', body);
  expect(byEditor.body).toEqual({ status: 'error', requestId, reason: 'not_permitted' });
  const fresh = { requestId: randomUUID(), enabled: true };
  const byAdmin = await command(
    db,
    { email: IAN_EMAIL },
    scene.harnessId,
    'set_hosted_builder',
    fresh,
  );
  expect(byAdmin.body).toEqual({ status: 'accepted', requestId: fresh.requestId });
  const [set] = await eventsNamed(db, scene.harnessId, 'hosted_builder_set');
  expect(set).toMatchObject({ evidence: { enabled: true }, requestId: fresh.requestId });
}

async function ownerStops(db: Database): Promise<void> {
  const scene = await hostedRun(db);
  const sent = await send(db, IAN_EMAIL, scene, 'stop_run');
  expect(sent.body).toMatchObject({ status: 'accepted' });
  expect(await runOf(db, scene.runId)).toMatchObject({ outcome: 'stopped' });
  expect((await itemState(db, scene.itemId)).holder).toBeNull();
  const [stopped] = await eventsNamed(db, scene.harnessId, 'run_stopped');
  expect(stopped?.evidence).toEqual({ runId: scene.runId, why: 'stopped_by_person' });
}

async function editorRefused(db: Database): Promise<void> {
  const scene = await hostedRun(db);
  const before = await eventCount(db, scene.harnessId);
  for (const [name, extra] of [
    ['stop_run', {}],
    ['prompt_run', { message: 'Look again' }],
  ] as const) {
    const sent = await send(db, scene.editor.email, scene, name, extra);
    expect(sent.status).toBe(403);
    expect(sent.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  }
  expect(await eventCount(db, scene.harnessId)).toBe(before);
  expect((await runOf(db, scene.runId))?.outcome).toBe('running');
}

async function promptDelivered(db: Database): Promise<void> {
  const scene = await hostedRun(db);
  const message = 'Rebase on main first.';
  const sent = await send(db, IAN_EMAIL, scene, 'prompt_run', { message });
  expect(sent.body).toMatchObject({ status: 'accepted' });
  const kernel = kernelOn(db, { now: () => new Date() });
  const step = {
    itemId: scene.itemId,
    runId: scene.runId,
    step: 'work' as const,
    tokensIn: 10,
    tokensOut: 2,
    costBasis: 'metered' as const,
    costMinor: 0,
  };
  expect(accepted(await kernel.items.recordRunStep(scene.beat, step)).prompts).toEqual([message]);
  expect(accepted(await kernel.items.recordRunStep(scene.beat, step)).prompts).toEqual([]);
}

async function noLiveRun(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const itemId = await enqueued(db, scene.harnessId, 'Nothing runs here');
  const requestId = randomUUID();
  const body = { requestId, itemId };
  const sent = await command(db, { email: IAN_EMAIL }, scene.harnessId, 'stop_run', body);
  expect(sent.status).toBe(404);
  expect(sent.body).toEqual({ status: 'error', requestId, reason: 'run_not_found' });
}

async function replayedStop(db: Database): Promise<void> {
  const scene = await hostedRun(db);
  const body = { requestId: randomUUID(), itemId: scene.itemId };
  const first = await command(db, { email: IAN_EMAIL }, scene.harnessId, 'stop_run', body);
  const events = await eventCount(db, scene.harnessId);
  const second = await command(db, { email: IAN_EMAIL }, scene.harnessId, 'stop_run', body);
  expect(first.body).toMatchObject({ status: 'accepted' });
  expect(second.status).toBe(first.status);
  expect(second.text).toBe(first.text);
  expect(await eventCount(db, scene.harnessId)).toBe(events);
  expect(await eventsNamed(db, scene.harnessId, 'run_stopped')).toHaveLength(1);
}

async function stopReachesTheWorkflow(db: Database): Promise<void> {
  const scene = await hostedRun(db);
  const binding = fakeWorkflowBinding();
  const runs = platformRuns(binding);
  await runs.start({
    runId: scene.runId,
    harnessId: scene.harnessId,
    itemId: scene.itemId,
    persona: 'agent:builder',
    runShape: 'workflow-run',
    engine: 'claude-messages',
    traceId: randomUUID(),
  });
  const body = { requestId: randomUUID(), itemId: scene.itemId };
  const outcome = await dispatchAs(scene.admin, scene.harnessId, 'stop_run', body, {
    ...dispatchScope(db),
    runs,
  });
  expect(outcome).toMatchObject({ status: 'accepted' });
  expect(binding.calls).toEqual([`create ${scene.runId}`, `terminate ${scene.runId}`]);
  expect(await runs.status(scene.runId)).toBe('stopped');
}

describe.skipIf(!testServer)('the run and hosted Builder commands', () => {
  it('HE-8 an admin turns hosted Builder on through set_hosted_builder; an editor is refused not_permitted', () =>
    withAppDatabase(hostedBuilderSwitch));

  it('HE-1 stop_run by the delegating person stops the run and releases the item', () =>
    withAppDatabase(ownerStops));

  it('HE-1 stop_run and prompt_run by an editor who does not own the run are not_permitted', () =>
    withAppDatabase(editorRefused));

  it("prompt_run queues a message the run's next record_run_step answers", () =>
    withAppDatabase(promptDelivered));

  it('stop_run on an item with no live run is run_not_found', () => withAppDatabase(noLiveRun));

  it('a repeated requestId replays the first stop outcome', () => withAppDatabase(replayedStop));

  it("stop_run through the command route stops the run's Workflow on the platform Runs adapter", () =>
    withAppDatabase(stopReachesTheWorkflow));
});
