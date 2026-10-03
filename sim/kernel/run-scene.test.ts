import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { rewritePageFrontmatter } from '@uw/db/test-seed';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller } from '../fixtures.ts';
import {
  builderFrontmatter,
  detailOf,
  harnessNames,
  itemEvents,
  itemOf,
  personaCaller,
  reasonOf,
  runOf,
  runWorld,
  startOn,
  systemCaller,
  value,
  type RunWorld,
} from '../runs.ts';
import { createWorld } from '../world.ts';
import { readWorldLog } from '../runner/log.ts';

afterAll(closeEmbeddedTemplate);

type Started = RunWorld & { readonly runId: string; readonly logged: number };

async function inStarted(work: (scene: Started) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const scene = await runWorld(world);
    const { runId } = value(await startOn(scene));
    const logged = (await itemEvents(scene, scene.itemId)).length;
    await work({ ...scene, runId, logged });
    expect((await readWorldLog(world.adapters.store)).drift).toEqual([]);
  } finally {
    await world.close();
  }
}

function startedIt(title: string, work: (scene: Started) => Promise<void>): void {
  it(title, () => inStarted(work));
}

function sceneOf(scene: Started) {
  return scene.world.kernel.runs.scene(systemCaller(scene), scene.runId);
}

async function newNames(scene: Started): Promise<readonly string[]> {
  return (await itemEvents(scene, scene.itemId)).slice(scene.logged).map((event) => event.name);
}

async function principalIsTheBeat(scene: Started): Promise<void> {
  scene.world.adapters.clock.advance(5 * 60_000);
  const found = value(await sceneOf(scene));
  const beat = await scene.world.kernel.delegations.beat(personaCaller(scene), {
    delegationId: scene.delegationId,
  });
  expect(found.principal).toEqual(value(beat).principal);
  expect(found.principal.identity).toBe('agent:builder');
  expect(found.principal.grants.map((grant) => grant.role)).toEqual(['editor']);
  expect(found.capability).toBe('build');
  expect(found.item.holder).toBe('agent:builder');
  expect(found.harness.id).toBe(scene.harnessId);
  expect(found.run.id).toBe(scene.runId);
  expect(found.persona).toMatchObject({
    identity: 'agent:builder',
    pageId: scene.pageId,
    engine: 'claude-messages',
    model: 'claude-sonnet-5',
    provider: 'anthropic',
    toolset: ['read_page', 'record_run_step', 'submit_to_gate'],
  });
  expect(await newNames(scene)).toEqual([]);
}

async function onlyTheRunHost(scene: Started): Promise<void> {
  const asPersona = await scene.world.kernel.runs.scene(personaCaller(scene), scene.runId);
  expect(reasonOf(asPersona)).toBe('not_permitted');
  const asOwner = await scene.world.kernel.runs.scene(
    simCaller(scene.world, scene.owner),
    scene.runId,
  );
  expect(reasonOf(asOwner)).toBe('not_permitted');
  const unknown = scene.world.adapters.ids.next();
  const missing = await scene.world.kernel.runs.scene(systemCaller(scene), unknown);
  expect(reasonOf(missing)).toBe('run_not_found');
  expect(detailOf(missing)).toEqual({ runId: unknown });
}

async function refusesHibernated(scene: Started): Promise<void> {
  await scene.world.adapters.store.transaction(async (tx) => {
    const run = await tx.harnessRuns.read.lock(scene.runId);
    if (run === null) throw new Error('no run');
    await tx.harnessRuns.write.update({ ...run, outcome: 'hibernated', hibernatedFor: 'gate' });
  });
  const outcome = await sceneOf(scene);
  expect(reasonOf(outcome)).toBe('not_permitted');
  expect(detailOf(outcome)).toEqual({ why: 'run_hibernated' });
  expect(await newNames(scene)).toEqual([]);
  expect((await runOf(scene.world, scene.runId))?.outcome).toBe('hibernated');
}

async function stopsOnRevocation(scene: Started): Promise<void> {
  const revoked = await scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.owner), {
    delegationId: scene.delegationId,
  });
  expect(revoked.status).toBe('accepted');
  const lapsedBefore = (await harnessNames(scene)).filter((name) => name === 'delegation_lapsed');
  const outcome = await sceneOf(scene);
  expect(reasonOf(outcome)).toBe('delegation_lapsed');
  expect(detailOf(outcome)).toEqual({ delegationId: scene.delegationId, why: 'revoked' });
  const again = await sceneOf(scene);
  expect(detailOf(again)).toEqual({ why: 'run_stopped' });
  const lapsed = (await harnessNames(scene)).filter((name) => name === 'delegation_lapsed');
  expect(lapsed.length - lapsedBefore.length).toBe(1);
  expect(await newNames(scene)).toEqual(['run_stopped', 'item_released']);
  const events = (await itemEvents(scene, scene.itemId)).slice(scene.logged);
  expect(events[0]?.evidence).toEqual({ runId: scene.runId, why: 'delegation_lapsed' });
  const run = await runOf(scene.world, scene.runId);
  expect(run?.outcome).toBe('stopped');
  expect(run?.endedAt).not.toBeNull();
  expect((await itemOf(scene.world, scene.itemId))?.holder).toBeNull();
}

async function stopsOnLapsedLease(scene: Started): Promise<void> {
  scene.world.adapters.clock.advance(16 * 60_000);
  const outcome = await sceneOf(scene);
  expect(reasonOf(outcome)).toBe('lease_expired');
  expect(await newNames(scene)).toEqual(['lease_expired', 'run_stopped']);
  const events = (await itemEvents(scene, scene.itemId)).slice(scene.logged);
  expect(events[1]?.evidence).toEqual({ runId: scene.runId, why: 'lease_expired' });
  expect((await runOf(scene.world, scene.runId))?.outcome).toBe('stopped');
  expect((await itemOf(scene.world, scene.itemId))?.holder).toBeNull();
}

function rewritePage(scene: Started, change: Readonly<Record<string, unknown>>) {
  const frontmatter = builderFrontmatter(scene, change);
  return rewritePageFrontmatter(scene.world.database.db, scene.pageId, frontmatter);
}

async function answersThePin(scene: Started): Promise<void> {
  await rewritePage(scene, { engine: 'codex-sandbox', model: 'gpt-5.5', provider: 'openai' });
  const found = value(await sceneOf(scene));
  expect(found.persona).toMatchObject({
    identity: 'agent:builder',
    engine: 'claude-messages',
    model: 'claude-sonnet-5',
    provider: 'anthropic',
  });
  expect(await newNames(scene)).toEqual([]);
}

async function refusesAnotherPage(scene: Started): Promise<void> {
  const harnessesBefore = await harnessNames(scene);
  const changes = [{ identity: 'agent:reviewer' }, { harness: scene.world.adapters.ids.next() }];
  scene.world.adapters.clock.advance(16 * 60_000);
  for (const change of changes) {
    await rewritePage(scene, change);
    const outcome = await sceneOf(scene);
    expect(reasonOf(outcome)).toBe('not_permitted');
    expect(detailOf(outcome)).toEqual({ why: 'run_elsewhere' });
  }
  expect(await newNames(scene)).toEqual([]);
  expect(await harnessNames(scene)).toEqual(harnessesBefore);
  expect((await runOf(scene.world, scene.runId))?.outcome).toBe('running');
}

describe('kernel.runs.scene', () => {
  startedIt(
    "HE-1 a step's principal is the delegation's beat principal at the step's instant",
    principalIsTheBeat,
  );

  startedIt('refuses any caller but the run host, and an unknown run', onlyTheRunHost);

  startedIt(
    "HE-4 a scene answers the run's pinned engine, model and provider after the page changes",
    answersThePin,
  );

  startedIt(
    'a page now naming another identity or harness is refused run_elsewhere before the lease check and records nothing',
    refusesAnotherPage,
  );

  startedIt('HE-1 a scene for a hibernated run is refused run_hibernated', refusesHibernated);

  startedIt(
    'HE-1 a revoked delegation stops the run at the next step, records delegation_lapsed once and releases the item',
    stopsOnRevocation,
  );

  startedIt(
    'HE-1 a scene whose lease lapsed stops the run lease_expired and is refused lease_expired',
    stopsOnLapsedLease,
  );
});
