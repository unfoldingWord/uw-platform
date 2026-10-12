import type { Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { rewritePageFrontmatter } from '@uw/db/test-seed';
import { readAllEvents } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller, simPerson } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import {
  beatOf,
  builderFrontmatter,
  detailOf,
  itemEvents,
  reasonOf,
  runOf,
  runWorld,
  startOn,
  value,
  type RunWorld,
} from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inWorld(work: (scene: RunWorld) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await runWorld(world));
    expect((await readWorldLog(world.adapters.store)).drift).toEqual([]);
  } finally {
    await world.close();
  }
}

function setAs(scene: RunWorld, actor: Principal, enabled: boolean) {
  return scene.world.kernel.stages.setHostedBuilder(simCaller(scene.world, actor), {
    harnessId: scene.harnessId,
    enabled,
  });
}

async function harnessEvents(scene: RunWorld) {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, null),
  );
  return events.filter((event) => event.name === 'hosted_builder_set');
}

async function enabledOf(scene: RunWorld): Promise<boolean | undefined> {
  const harness = await scene.world.adapters.store.transaction((tx) =>
    tx.harnesses.read.byId(scene.harnessId),
  );
  return harness?.hostedBuilderEnabled;
}

function onSandbox(scene: RunWorld) {
  return rewritePageFrontmatter(
    scene.world.database.db,
    scene.pageId,
    builderFrontmatter(scene, { engine: 'claude-code-sandbox' }),
  );
}

async function adminTurnsOn(scene: RunWorld): Promise<void> {
  expect(await enabledOf(scene)).toBe(false);
  const turned = value(await setAs(scene, scene.admin, true));
  expect(turned.harness.hostedBuilderEnabled).toBe(true);
  expect(await enabledOf(scene)).toBe(true);
  const [set] = await harnessEvents(scene);
  expect(set).toMatchObject({ actor: scene.admin.identity, evidence: { enabled: true } });
  value(await setAs(scene, scene.admin, true));
  expect(await harnessEvents(scene)).toHaveLength(1);
}

async function othersRefused(scene: RunWorld): Promise<void> {
  const editor = await simPerson(scene.world, 6, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const byEditor = await setAs(scene, editor, true);
  expect(reasonOf(byEditor)).toBe('not_permitted');
  expect(detailOf(byEditor)).toEqual({ jdArea: '80-89' });
  const byAgent = await setAs(scene, scene.persona, true);
  expect(reasonOf(byAgent)).toBe('not_permitted');
  expect(detailOf(byAgent)).toEqual({ actor: 'agent:builder' });
  expect(await harnessEvents(scene)).toEqual([]);
  expect(await enabledOf(scene)).toBe(false);
}

async function offKeepsRun(scene: RunWorld): Promise<void> {
  await onSandbox(scene);
  expect(reasonOf(await startOn(scene))).toBe('hosted_builder_off');
  value(await setAs(scene, scene.admin, true));
  const { runId } = value(await startOn(scene));
  const before = (await itemEvents(scene, scene.itemId)).length;
  value(await setAs(scene, scene.admin, false));
  expect((await runOf(scene.world, runId))?.outcome).toBe('running');
  expect((await itemEvents(scene, scene.itemId)).length).toBe(before);
}

async function bareClaimRefused(scene: RunWorld): Promise<void> {
  await onSandbox(scene);
  const beat = await beatOf(scene);
  const claim = () =>
    scene.world.kernel.items.claim(beat, {
      itemId: scene.itemId,
      delegationId: scene.delegationId,
    });
  const before = (await itemEvents(scene, scene.itemId)).length;
  const refused = await claim();
  expect(reasonOf(refused)).toBe('hosted_builder_off');
  expect(detailOf(refused)).toEqual({ harnessId: scene.harnessId });
  expect((await itemEvents(scene, scene.itemId)).length).toBe(before);
  value(await setAs(scene, scene.admin, true));
  expect(value(await claim()).item.holder).toBe('agent:builder');
}

describe('the hosted Builder switch', () => {
  it('HE-8 hosted Builder is off by default and only an admin turns it on, recorded as hosted_builder_set', () =>
    inWorld(adminTurnsOn));

  it('HE-8 an editor and an agent are refused', () => inWorld(othersRefused));

  it('HE-8 turning it off does not stop a run already started', () => inWorld(offKeepsRun));

  it("HE-8 a bare persona's claim is refused hosted_builder_off when its engine needs hosted Builder", () =>
    inWorld(bareClaimRefused));
});
