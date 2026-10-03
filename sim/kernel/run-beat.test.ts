import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { rewritePageFrontmatter } from '@uw/db/test-seed';
import type { Caller } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import {
  builderFrontmatter,
  detailOf,
  itemInScope,
  personaCaller,
  reasonOf,
  runWorld,
  seedPersona,
  systemCaller,
  value,
  type RunWorld,
} from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const minute = 60_000;

async function inWorld(work: (scene: RunWorld) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await runWorld(world));
    expect((await readWorldLog(world.adapters.store)).drift).toEqual([]);
  } finally {
    await world.close();
  }
}

function beat(scene: RunWorld, caller: Caller = systemCaller(scene), limit = 10) {
  return scene.world.kernel.runs.beat(caller, { limit });
}

async function delegateTo(
  scene: RunWorld,
  persona: string,
  capability: 'build' | 'none',
): Promise<string> {
  const granted = await scene.world.kernel.delegations.grant(simCaller(scene.world, scene.owner), {
    harnessId: scene.harnessId,
    persona,
    capability,
    expiresAt: null,
    supersedes: null,
  });
  return value(granted).id;
}

async function startsOne(scene: RunWorld): Promise<void> {
  await itemInScope(scene, 'A later item');
  const beaten = value(await beat(scene));
  expect(beaten.skipped).toEqual([]);
  expect(beaten.started).toHaveLength(1);
  expect(beaten.started[0]).toMatchObject({
    itemId: scene.itemId,
    persona: 'agent:builder',
    engine: 'claude-messages',
  });
}

async function startsNothingElse(scene: RunWorld): Promise<void> {
  const cases = [
    { identity: 'agent:scout', status: 'suggested' as const, capability: 'build' as const },
    { identity: 'agent:idle', status: 'active' as const, capability: 'none' as const },
    { identity: 'agent:outside', status: 'active' as const, capability: 'build' as const },
  ];
  for (const [index, entry] of cases.entries()) {
    await delegateTo(scene, entry.identity, entry.capability);
    const shape =
      entry.identity === 'agent:outside' ? { run_shape: 'external-run', engine: 'external' } : {};
    await seedPersona(scene, {
      id: `00000000-0000-4000-8000-00000000960${index.toString()}`,
      status: entry.status,
      frontmatter: builderFrontmatter(scene, { identity: entry.identity, ...shape }),
    });
  }
  await rewritePageFrontmatter(
    scene.world.database.db,
    scene.pageId,
    builderFrontmatter(scene, { run_shape: 'external-run', engine: 'external' }),
  );
  const beaten = value(await beat(scene));
  expect(beaten).toEqual({ started: [], skipped: [] });
}

async function noSecondRun(scene: RunWorld): Promise<void> {
  await itemInScope(scene, 'A second item');
  expect(value(await beat(scene)).started).toHaveLength(1);
  expect(value(await beat(scene))).toEqual({ started: [], skipped: [] });
}

async function systemOnly(scene: RunWorld): Promise<void> {
  for (const caller of [personaCaller(scene), simCaller(scene.world, scene.admin)]) {
    const refused = await beat(scene, caller);
    expect(reasonOf(refused)).toBe('not_permitted');
    expect(detailOf(refused)).toEqual({ actor: caller.actor.identity });
  }
  for (const limit of [0, 51, 1.5]) {
    expect(reasonOf(await beat(scene, systemCaller(scene), limit))).toBe('malformed_command');
  }
}

async function holdOnce(scene: RunWorld): Promise<void> {
  const [started] = value(await beat(scene)).started;
  if (started === undefined) throw new Error('the beat started nothing');
  const host = systemCaller(scene);
  value(await scene.world.kernel.runs.holdPremise(host, started.runId, { reason: 'not yet' }));
}

async function backsOff(scene: RunWorld): Promise<void> {
  await holdOnce(scene);
  expect(value(await beat(scene)).started).toEqual([]);
  scene.world.adapters.clock.advance(14 * minute);
  expect(value(await beat(scene)).started).toEqual([]);
  scene.world.adapters.clock.advance(2 * minute);
  await holdOnce(scene);
  scene.world.adapters.clock.advance(16 * minute);
  expect(value(await beat(scene)).started).toEqual([]);
  scene.world.adapters.clock.advance(15 * minute);
  expect(value(await beat(scene)).started).toHaveLength(1);
}

describe('the hosted beat', () => {
  it('HE-1 the beat starts one run per live delegation whose active persona is a workflow-run', () =>
    inWorld(startsOne));

  it('HE-1 the beat starts nothing for a suggested persona, a capability none delegation or an external-run persona', () =>
    inWorld(startsNothingElse));

  it('HE-1 the beat does not start a second run for a persona that has a live one', () =>
    inWorld(noSecondRun));

  it('HE-1 only the system principal may beat', () => inWorld(systemOnly));

  it('the beat backs off a persona from an item whose run held its premise, doubling from fifteen minutes', () =>
    inWorld(backsOff));
});
