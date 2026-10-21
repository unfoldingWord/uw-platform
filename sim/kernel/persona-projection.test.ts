import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { rewritePageStatus, seedPage } from '@uw/db/test-seed';
import { readAllEvents } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simAgent, simCaller } from '../fixtures.ts';
import {
  builderFrontmatter,
  itemInScope,
  runWorld,
  systemCaller,
  value,
  type RunWorld,
} from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const shadowPage = '00000000-0000-4000-8000-000000009701';

async function inWorld(work: (scene: RunWorld) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await runWorld(world));
  } finally {
    await world.close();
  }
}

function beat(scene: RunWorld) {
  return scene.world.kernel.runs.beat(systemCaller(scene), { limit: 10 });
}

async function unprojectedShadow(scene: RunWorld): Promise<void> {
  const granted = await scene.world.kernel.delegations.grant(simCaller(scene.world, scene.owner), {
    harnessId: scene.harnessId,
    persona: 'agent:shadow',
    capability: 'build',
    maxTier: null,
    expiresAt: null,
    supersedes: null,
  });
  value(granted);
  await seedPage(scene.world.database.db, {
    id: shadowPage,
    type: 'persona',
    status: 'active',
    jdArea: '80-89',
    slug: 'persona-shadow',
    title: 'Shadow',
    bodyMd: 'Shadow builds without being activated.',
    frontmatter: builderFrontmatter(scene, { identity: 'agent:shadow', status: 'active' }),
  });
}

function delegatedRunner(scene: RunWorld) {
  const identity = `${scene.owner.personId ?? ''}/laptop as builder via delegation:${scene.delegationId}`;
  return simCaller(scene.world, simAgent(scene.owner, identity, { interactive: false }));
}

async function polledIds(scene: RunWorld): Promise<readonly string[]> {
  const input = { harnessId: scene.harnessId, limit: 50 };
  const polled = value(await scene.world.kernel.reads.poll(delegatedRunner(scene), input));
  return polled.map((item) => item.itemId);
}

async function itemLog(scene: RunWorld): Promise<readonly string[]> {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, scene.itemId),
  );
  return events.map((event) => event.name);
}

async function beatOnlyForProjected(scene: RunWorld): Promise<void> {
  await unprojectedShadow(scene);
  await itemInScope(scene, 'A second item');
  const db = scene.world.database.db;
  await rewritePageStatus(db, scene.pageId, 'suggested');
  expect(value(await beat(scene))).toEqual({ started: [], skipped: [] });
  await rewritePageStatus(db, scene.pageId, 'active');
  const started = value(await beat(scene)).started;
  expect(started.map((run) => run.persona)).toEqual(['agent:builder']);
}

async function pollAndClaimOnlyWhereActive(scene: RunWorld): Promise<void> {
  expect(await polledIds(scene)).toContain(scene.itemId);
  await rewritePageStatus(scene.world.database.db, scene.pageId, 'suggested');
  expect(await polledIds(scene)).toEqual([]);
  const before = await itemLog(scene);
  const claimed = await scene.world.kernel.items.claim(delegatedRunner(scene), {
    itemId: scene.itemId,
    delegationId: scene.delegationId,
  });
  expect(claimed).toEqual({
    status: 'error',
    reason: 'not_permitted',
    detail: { why: 'persona_not_active' },
  });
  expect(await itemLog(scene)).toEqual(before);
}

describe('the personas projection decides where a persona works', () => {
  it('PE-3 the beat starts runs only for personas the projection names active', () =>
    inWorld(beatOnlyForProjected));

  it('PE-3 a delegated persona polls and claims only where its persona is active', () =>
    inWorld(pollAndClaimOnlyWhereActive));
});
