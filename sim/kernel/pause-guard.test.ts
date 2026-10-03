import type { Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software, type Caller, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createSimHarness,
  simAdvance,
  simAgent,
  simCaller,
  simParkedAtCheck,
  simPerson,
} from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly admin: Principal;
  readonly max: Principal;
  readonly agent: Caller;
};

const paused = ['not_permitted', { why: 'paused', stage: 'scope' }];

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const max = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const enqueued = await world.kernel.items.enqueue(simCaller(world, max), {
      harnessId: harness.id,
      title: 'Scope the board',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    });
    if (enqueued.status !== 'accepted') throw new Error(`enqueue: ${enqueued.reason}`);
    const { itemId } = enqueued.value;
    await simAdvance(world, { harnessId: harness.id, itemId, worker: max, through: ['package'] });
    const agent = simAgent(max, `${max.personId}/builder`, { interactive: true });
    const scene = { world, harnessId: harness.id, itemId, admin, max };
    await work({ ...scene, agent: simCaller(world, agent) });
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

function outcomeOf(outcome: KernelOutcome<unknown>) {
  return outcome.status === 'accepted' ? 'accepted' : [outcome.reason, outcome.detail];
}

async function control(scene: Scene, name: 'pause' | 'resume', stageKey: string | null) {
  const caller = simCaller(scene.world, scene.admin);
  const input = { harnessId: scene.harnessId, stageKey };
  const { stages } = scene.world.kernel;
  const outcome = await (name === 'pause'
    ? stages.pause(caller, input)
    : stages.resume(caller, input));
  expect(outcome.status).toBe('accepted');
}

function claimAs(scene: Scene, caller: Caller) {
  return scene.world.kernel.items.claim(caller, { itemId: scene.itemId, delegationId: null });
}

function submitAs(scene: Scene, caller: Caller) {
  return scene.world.kernel.items.submit(caller, {
    itemId: scene.itemId,
    to: null,
    evidence: {},
    change: null,
  });
}

function stepAs(scene: Scene, caller: Caller) {
  return scene.world.kernel.items.recordRunStep(caller, {
    itemId: scene.itemId,
    runId: scene.world.adapters.ids.next(),
    step: 'read',
    tokensIn: 1,
    tokensOut: 1,
    costBasis: 'subscription',
  });
}

async function claimsWhilePaused(scene: Scene, stageKey: string | null): Promise<void> {
  await control(scene, 'pause', stageKey);
  expect(outcomeOf(await claimAs(scene, scene.agent))).toEqual(paused);
  await control(scene, 'resume', stageKey);
  expect(outcomeOf(await claimAs(scene, scene.agent))).toBe('accepted');
}

describe('WB-1 a paused harness or lane stops agents and never people', () => {
  sceneIt(
    'refuses an agent claim by item id in a paused harness, and takes it after resume',
    (scene) => claimsWhilePaused(scene, null),
  );

  sceneIt(
    'refuses an agent claim by item id in a paused lane, and takes it after resume',
    (scene) => claimsWhilePaused(scene, 'scope'),
  );

  sceneIt('refuses an agent submit and run step at a paused lane', async (scene) => {
    expect(outcomeOf(await claimAs(scene, scene.agent))).toBe('accepted');
    await control(scene, 'pause', 'scope');
    expect(outcomeOf(await submitAs(scene, scene.agent))).toEqual(paused);
    expect(outcomeOf(await stepAs(scene, scene.agent))).toEqual(paused);
    await control(scene, 'resume', 'scope');
    expect(outcomeOf(await stepAs(scene, scene.agent))).toBe('accepted');
    expect(outcomeOf(await submitAs(scene, scene.agent))).toBe('accepted');
  });

  sceneIt('lets a person claim and submit in a paused harness', async (scene) => {
    await control(scene, 'pause', null);
    const max = simCaller(scene.world, scene.max);
    expect(outcomeOf(await claimAs(scene, max))).toBe('accepted');
    expect(outcomeOf(await submitAs(scene, max))).toBe('accepted');
  });

  sceneIt('lets a person decide a gate in a paused harness and lane', async (scene) => {
    const { world, harnessId, admin } = scene;
    const parked = await simParkedAtCheck(world, { harnessId, admin, title: 'Check it' });
    await control(scene, 'pause', null);
    await control(scene, 'pause', 'check');
    const decided = await world.kernel.gates.decide(simCaller(world, admin), {
      itemId: parked.itemId,
      decision: 'approve',
      reason: null,
      findings: [],
    });
    expect(decided.status === 'accepted' && decided.value.item.stageKey).toBe('ship');
  });
});
