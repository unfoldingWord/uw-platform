import { newEventSchema } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { rewritePageFrontmatter } from '@uw/db/test-seed';
import { createKernel, PortNotWiredError } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { readSpend } from '../fixtures.ts';
import {
  builderFrontmatter,
  detailOf,
  itemEvents,
  itemInScope,
  itemOf,
  reasonOf,
  runOf,
  runWorld,
  seedPersona,
  startOn,
  value,
  type RunWorld,
} from '../runs.ts';
import { createWorld } from '../world.ts';
import { readWorldLog } from '../runner/log.ts';

afterAll(closeEmbeddedTemplate);

async function inRunWorld(work: (scene: RunWorld) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await runWorld(world));
    expect((await readWorldLog(world.adapters.store)).drift).toEqual([]);
  } finally {
    await world.close();
  }
}

function runIt(title: string, work: (scene: RunWorld) => Promise<void>): void {
  it(title, () => inRunWorld(work));
}

async function namesOf(scene: RunWorld, itemId = scene.itemId): Promise<readonly string[]> {
  return (await itemEvents(scene, itemId)).map((event) => event.name);
}

async function liveRuns(scene: RunWorld) {
  return scene.world.adapters.store.transaction((tx) => tx.harnessRuns.read.live(null));
}

async function refusesQuietly(scene: RunWorld, reason: string, detail: unknown): Promise<void> {
  const before = await namesOf(scene);
  const outcome = await startOn(scene);
  expect(reasonOf(outcome)).toBe(reason);
  expect(detailOf(outcome)).toEqual(detail);
  expect(await namesOf(scene)).toEqual(before);
  expect(await liveRuns(scene)).toEqual([]);
  expect((await itemOf(scene.world, scene.itemId))?.holder).toBeNull();
}

function rewritten(scene: RunWorld, change: Readonly<Record<string, unknown>>) {
  return rewritePageFrontmatter(
    scene.world.database.db,
    scene.pageId,
    builderFrontmatter(scene, change),
  );
}

async function startsAndClaims(scene: RunWorld): Promise<void> {
  const before = (await namesOf(scene)).length;
  const started = value(await startOn(scene));
  const item = await itemOf(scene.world, scene.itemId);
  expect(item?.holder).toBe('agent:builder');
  expect(item?.delegationId).toBe(scene.delegationId);
  expect(started.leaseExpiresAt).toBe(item?.leaseExpiresAt);
  const events = (await itemEvents(scene, scene.itemId)).slice(before);
  expect(events.map((event) => event.name)).toEqual(['item_claimed', 'run_started']);
  expect(events[1]?.evidence).toEqual({
    runId: started.runId,
    persona: 'agent:builder',
    runShape: 'workflow-run',
    engine: 'claude-messages',
    model: 'claude-sonnet-5',
    delegationId: scene.delegationId,
  });
  const run = await runOf(scene.world, started.runId);
  expect(run).toMatchObject({
    itemId: scene.itemId,
    persona: 'agent:builder',
    personaPageId: scene.pageId,
    delegationId: scene.delegationId,
    runShape: 'workflow-run',
    pinnedProvider: 'anthropic',
    outcome: 'running',
    costBasis: 'metered',
    costMinor: 0,
    computeMinor: 0,
    steps: [],
  });
  expect(events.every((event) => event.traceId === run?.traceId)).toBe(true);
  expect(await scene.world.adapters.runs.status(started.runId)).toBe('running');
}

async function failsWhenThePortRefuses(scene: RunWorld): Promise<void> {
  const { world } = scene;
  const runs = {
    ...world.adapters.runs,
    start: async () => {
      throw new PortNotWiredError('runs', 'start');
    },
  };
  const kernel = createKernel({ ...world.adapters, runs });
  const before = (await namesOf(scene)).length;
  const outcome = await startOn({ ...scene, world: { ...world, kernel } });
  expect(reasonOf(outcome)).toBe('not_wired');
  const events = (await itemEvents(scene, scene.itemId)).slice(before);
  const run = await runOf(world, String(events[1]?.evidence.runId));
  expect(run).toMatchObject({ outcome: 'failed', failure: 'start_failed' });
  expect(run?.endedAt).not.toBeNull();
  expect(events.map((event) => event.name)).toEqual([
    'item_claimed',
    'run_started',
    'run_failed',
    'item_released',
  ]);
  expect(events[2]?.evidence).toEqual({
    runId: run?.id,
    step: null,
    why: 'start_failed',
    detail: 'PortNotWiredError',
  });
  expect((await itemOf(world, scene.itemId))?.holder).toBeNull();
}

async function refusesBuilderOff(scene: RunWorld): Promise<void> {
  await rewritten(scene, { engine: 'claude-code-sandbox' });
  await refusesQuietly(scene, 'hosted_builder_off', { harnessId: scene.harnessId });
}

async function refusesReservedEngine(scene: RunWorld): Promise<void> {
  await rewritten(scene, { engine: 'claude-managed-agent' });
  await refusesQuietly(scene, 'engine_not_available', { engine: 'claude-managed-agent' });
}

async function refusesWithoutProvider(scene: RunWorld): Promise<void> {
  await rewritten(scene, { engine: 'openrouter-messages', model: 'z-ai/glm-5.3-flash' });
  await refusesQuietly(scene, 'malformed_command', { why: 'provider_required' });
  await rewritten(scene, {
    engine: 'openrouter-messages',
    model: 'z-ai/glm-5.3-flash',
    provider: 'z-ai',
  });
  const started = value(await startOn(scene));
  expect((await runOf(scene.world, started.runId))?.pinnedProvider).toBe('z-ai');
}

async function refusesExternalShape(scene: RunWorld): Promise<void> {
  await rewritten(scene, { run_shape: 'external-run', engine: 'external' });
  await refusesQuietly(scene, 'not_permitted', { why: 'run_shape' });
}

async function refusesWhileHolding(scene: RunWorld): Promise<void> {
  const { world, harnessId } = scene;
  await world.adapters.store.transaction((tx) =>
    tx.harnessEvents.write.append([
      newEventSchema.parse({
        eventId: world.adapters.ids.next(),
        harnessId,
        itemId: null,
        name: 'breaker_holding',
        at: world.adapters.clock.now().toISOString(),
        actor: 'agent:system',
        evidence: { spentMinor: 100_000, capMinor: 125_000, currency: 'USD', percent: 80 },
        traceId: world.adapters.ids.next(),
        requestId: null,
      }),
    ]),
  );
  await refusesQuietly(scene, 'spend_held', { level: 'holding' });
}

async function hidesOtherPages(scene: RunWorld): Promise<void> {
  const suggested = '00000000-0000-4000-8000-000000009511';
  const another = '00000000-0000-4000-8000-000000009512';
  const elsewhere = '00000000-0000-4000-8000-000000009513';
  await seedPersona(scene, { id: suggested, status: 'suggested' });
  const otherPersona = builderFrontmatter(scene, { identity: 'agent:reviewer' });
  await seedPersona(scene, { id: another, frontmatter: otherPersona });
  const otherHarness = builderFrontmatter(scene, { harness: scene.world.adapters.ids.next() });
  await seedPersona(scene, { id: elsewhere, frontmatter: otherHarness });
  const before = await namesOf(scene);
  for (const pageId of [suggested, another, elsewhere]) {
    const outcome = await startOn(scene, { pageId });
    expect(reasonOf(outcome)).toBe('page_not_found');
    expect(detailOf(outcome)).toEqual({ pageId });
  }
  expect(await namesOf(scene)).toEqual(before);
  expect(await liveRuns(scene)).toEqual([]);
}

async function refusesSecondStart(scene: RunWorld): Promise<void> {
  const first = value(await startOn(scene));
  const before = await namesOf(scene);
  const second = await startOn(scene);
  expect(reasonOf(second)).toBe('lease_held');
  expect(await namesOf(scene)).toEqual(before);
  expect((await liveRuns(scene)).map((run) => run.id)).toEqual([first.runId]);
}

async function refusesOverStaleRun(scene: RunWorld): Promise<void> {
  const first = value(await startOn(scene));
  scene.world.adapters.clock.advance(16 * 60_000);
  await readSpend(scene.world);
  const second = await startOn(scene);
  expect(reasonOf(second)).toBe('lease_held');
  expect((await liveRuns(scene)).map((run) => run.id)).toEqual([first.runId]);
  const otherItem = await itemInScope(scene, 'A second item');
  expect(reasonOf(await startOn(scene, { itemId: otherItem }))).toBeNull();
}

describe('kernel.runs.start', () => {
  runIt(
    'HE-1 a start claims the item under the delegation, writes one running run and records run_started',
    startsAndClaims,
  );

  runIt(
    'HE-1 a start the Runs port refuses fails the run start_failed and releases the item',
    failsWhenThePortRefuses,
  );

  runIt(
    'HE-8 a start on a sandbox engine where hosted Builder is off is refused hosted_builder_off and records nothing',
    refusesBuilderOff,
  );

  runIt(
    'a start on claude-managed-agent is refused engine_not_available and records nothing',
    refusesReservedEngine,
  );

  runIt(
    'HE-4 a start on openrouter-messages without a provider is refused provider_required',
    refusesWithoutProvider,
  );

  runIt('a start on an external-run persona is refused run_shape', refusesExternalShape);

  runIt(
    'a start while the breaker holds is refused spend_held and records nothing',
    refusesWhileHolding,
  );

  runIt(
    "HE-1 a start with a suggested persona page, another persona's page or another harness's page is page_not_found",
    hidesOtherPages,
  );

  runIt(
    'HE-1 a second start on an item with a live run is refused lease_held and writes no second run',
    refusesSecondStart,
  );

  runIt(
    'a start on an item whose earlier run is still live, with its lease lapsed, is refused lease_held',
    refusesOverStaleRun,
  );
});
