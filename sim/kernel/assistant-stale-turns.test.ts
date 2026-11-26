import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { runToolLoop, type LoopResult, type ToolCaller } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assistantLog,
  assistantNames,
  beginTurn,
  grantedScene,
  replyWith,
  requestId,
  type AssistantScene,
  type BegunTurn,
} from '../assistant-fixtures.ts';
import { readSpend, simCaller, simPerson, simSystem } from '../fixtures.ts';
import { value } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const MINUTE_MS = 60_000;
const STALE_MS = 61 * MINUTE_MS;

const noTools: ToolCaller = {
  call: async () => ({ output: { error: 'not_wired' }, isError: true }),
};

async function withScene(work: (scene: AssistantScene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await grantedScene(world));
  } finally {
    await world.close();
  }
}

async function begun(scene: AssistantScene, externalId: string) {
  const id = await requestId(scene, { externalId, note: 'What is next?' });
  const turn = value(await beginTurn(scene, id));
  return { id, turn };
}

async function loopFor(scene: AssistantScene, turn: BegunTurn): Promise<LoopResult> {
  scene.world.adapters.modelEngine.respondNextWith(replyWith('Your next step.', 30_000));
  const loop = scene.world.adapters.modelEngine.turn;
  return runToolLoop(loop, noTools, turn.loop, async () => undefined);
}

function finishWith(scene: AssistantScene, id: string, turn: BegunTurn, result: LoopResult) {
  const { world } = scene;
  return world.kernel.assistants.finishTurn(simCaller(world, simSystem()), {
    requestId: id,
    turnId: turn.turnId,
    result,
  });
}

function sweep(scene: AssistantScene) {
  const { world } = scene;
  return world.kernel.assistants.closeStaleTurns(simCaller(world, simSystem()), { limit: 50 });
}

async function openTurns(scene: AssistantScene): Promise<number> {
  const spent = await scene.world.adapters.store.transaction((tx) =>
    tx.harnessEvents.read.assistantSpend({ harnessId: scene.harness.id, since: new Date(0) }),
  );
  return spent.openTurns;
}

async function finishedOutcomes(scene: AssistantScene): Promise<readonly unknown[]> {
  const events = await assistantLog(scene);
  return events
    .filter((event) => event.name === 'assistant_turn_finished')
    .map((event) => [event.evidence['outcome'], event.evidence['costMicros']]);
}

async function abandonsAnOldTurn(scene: AssistantScene): Promise<void> {
  const { id, turn } = await begun(scene, '1701');
  expect(await openTurns(scene)).toBe(1);
  scene.world.adapters.clock.advance(STALE_MS);
  await readSpend(scene.world);
  expect(value(await sweep(scene))).toEqual({ abandoned: [turn.turnId], settled: [] });
  expect(await openTurns(scene)).toBe(0);
  expect(await finishedOutcomes(scene)).toEqual([['abandoned', 0]]);
  const late = await finishWith(scene, id, turn, await loopFor(scene, turn));
  expect(late).toMatchObject({ status: 'error', reason: 'stale_version' });
  expect(scene.world.adapters.directMessages.sent()).toEqual([]);
  expect(value(await sweep(scene))).toEqual({ abandoned: [], settled: [] });
}

async function leavesAYoungTurn(scene: AssistantScene): Promise<void> {
  await begun(scene, '1702');
  scene.world.adapters.clock.advance(30 * MINUTE_MS);
  expect(value(await sweep(scene))).toEqual({ abandoned: [], settled: [] });
  expect(await openTurns(scene)).toBe(1);
}

async function settlesAReplyPastItsLease(scene: AssistantScene): Promise<void> {
  const { id, turn } = await begun(scene, '1703');
  const result = await loopFor(scene, turn);
  scene.world.adapters.clock.advance(55 * MINUTE_MS);
  const hold = scene.world.adapters.directMessages.holdNext();
  const sending = finishWith(scene, id, turn, result);
  await hold.arrived;
  scene.world.adapters.clock.advance(6 * MINUTE_MS);
  expect(value(await sweep(scene))).toEqual({ abandoned: [], settled: [] });
  scene.world.adapters.clock.advance(5 * MINUTE_MS);
  expect(value(await sweep(scene))).toEqual({ abandoned: [], settled: [turn.turnId] });
  hold.release();
  expect(value(await sending).delivery).toBe('outcome_unknown');
  expect(scene.world.adapters.directMessages.sent()).toEqual([]);
  const names = assistantNames(await assistantLog(scene));
  expect(names.filter((name) => name === 'assistant_turn_finished')).toHaveLength(1);
  expect(await openTurns(scene)).toBe(0);
}

async function onlyTheSystemSweeps(scene: AssistantScene): Promise<void> {
  const { world } = scene;
  const person = await simPerson(world, 7, []);
  const outcome = await world.kernel.assistants.closeStaleTurns(simCaller(world, person), {
    limit: 5,
  });
  expect(outcome).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const bounded = await world.kernel.assistants.closeStaleTurns(simCaller(world, simSystem()), {
    limit: 500,
  });
  expect(bounded).toMatchObject({ status: 'error', reason: 'malformed_command' });
}

describe('R11 a sweep closes the turns a crashed host left open', () => {
  it('abandons a turn open past the hour, releasing its reservation, and a late finish sends nothing', () =>
    withScene(abandonsAnOldTurn));

  it('leaves a turn that is still within the hour', () => withScene(leavesAYoungTurn));

  it('settles an old turn whose reply is held past its lease as outcome_unknown, once', () =>
    withScene(settlesAReplyPastItsLease));

  it('is run only by the system, at most two hundred turns a pass', () =>
    withScene(onlyTheSystemSweeps));
});
