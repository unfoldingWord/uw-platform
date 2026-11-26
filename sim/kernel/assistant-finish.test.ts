import { assistantIdentityOf } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { runToolLoop, type LoopResult, type ToolCaller } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assistantLog,
  assistantNames,
  assistantScene,
  beginTurn,
  replyWith,
  requestId,
  type AssistantScene,
  type BegunTurn,
} from '../assistant-fixtures.ts';
import { readSpend, simCaller, simSystem } from '../fixtures.ts';
import { value } from '../runs.ts';
import { personOf } from '../wakes.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const LEASE_PASSED_MS = 11 * 60_000;
const SEND_WINDOW_PASSED_MS = 6 * 60_000;
const HOUR_MS = 60 * 60_000;

const noTools: ToolCaller = {
  call: async () => ({ output: { error: 'not_wired' }, isError: true }),
};

async function withScene(work: (scene: AssistantScene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await assistantScene(world));
  } finally {
    await world.close();
  }
}

async function grantFor(scene: AssistantScene, expiresAt: Date | null): Promise<string> {
  const { world, person, harness } = scene;
  const granted = value(
    await world.kernel.delegations.grant(simCaller(world, person), {
      harnessId: harness.id,
      persona: assistantIdentityOf(personOf(person)),
      capability: 'assist',
      maxTier: null,
      expiresAt,
      supersedes: null,
    }),
  );
  await readSpend(world);
  return granted.id;
}

async function begun(scene: AssistantScene, externalId: string) {
  const id = await requestId(scene, { externalId, note: 'What is next?' });
  const turn = value(await beginTurn(scene, id));
  scene.world.adapters.modelEngine.respondNextWith(replyWith('Your next step.', 30_000));
  const loop = scene.world.adapters.modelEngine.turn;
  const result = await runToolLoop(loop, noTools, turn.loop, async () => undefined);
  return { id, turn, result };
}

function finishWith(scene: AssistantScene, id: string, turn: BegunTurn, result: LoopResult) {
  const { world } = scene;
  return world.kernel.assistants.finishTurn(simCaller(world, simSystem()), {
    requestId: id,
    turnId: turn.turnId,
    result,
  });
}

async function namesOf(scene: AssistantScene): Promise<readonly string[]> {
  return assistantNames(await assistantLog(scene));
}

function counted(names: readonly string[], name: string): number {
  return names.filter((entry) => entry === name).length;
}

async function retryWhileSending(scene: AssistantScene): Promise<void> {
  await grantFor(scene, null);
  const { id, turn, result } = await begun(scene, '701');
  const hold = scene.world.adapters.directMessages.holdNext();
  const sending = finishWith(scene, id, turn, result);
  await hold.arrived;
  const retry = await finishWith(scene, id, turn, result);
  expect(retry.status === 'error' && retry.reason).toBe('request_in_flight');
  expect(counted(await namesOf(scene), 'assistant_turn_finished')).toBe(0);
  hold.release();
  const first = value(await sending);
  expect(first.delivery).toBe('sent');
  const later = value(await finishWith(scene, id, turn, result));
  expect(later).toEqual(first);
  const names = await namesOf(scene);
  expect(counted(names, 'assistant_effect_done')).toBe(1);
  expect(counted(names, 'assistant_effect_failed')).toBe(0);
  expect(counted(names, 'assistant_turn_finished')).toBe(1);
  expect(scene.world.adapters.directMessages.sent()).toHaveLength(1);
}

async function leasePassed(scene: AssistantScene): Promise<void> {
  await grantFor(scene, null);
  const { id, turn, result } = await begun(scene, '711');
  const hold = scene.world.adapters.directMessages.holdNext();
  const sending = finishWith(scene, id, turn, result);
  await hold.arrived;
  scene.world.adapters.clock.advance(LEASE_PASSED_MS);
  const retry = value(await finishWith(scene, id, turn, result));
  expect(retry.delivery).toBe('outcome_unknown');
  hold.release();
  expect(value(await sending)).toEqual(retry);
  const names = await namesOf(scene);
  expect(counted(names, 'assistant_effect_done')).toBe(0);
  expect(counted(names, 'assistant_effect_failed')).toBe(1);
  expect(counted(names, 'assistant_turn_finished')).toBe(1);
  expect(scene.world.adapters.directMessages.sent()).toEqual([]);
}

async function sendWindowPassed(scene: AssistantScene): Promise<void> {
  await grantFor(scene, null);
  const { id, turn, result } = await begun(scene, '712');
  const hold = scene.world.adapters.directMessages.holdNext();
  const sending = finishWith(scene, id, turn, result);
  await hold.arrived;
  scene.world.adapters.clock.advance(SEND_WINDOW_PASSED_MS);
  hold.release();
  expect(value(await sending).delivery).toBe('deadline_passed');
  expect(scene.world.adapters.directMessages.sent()).toEqual([]);
  const retry = value(await finishWith(scene, id, turn, result));
  expect(retry.delivery).toBe('deadline_passed');
  const names = await namesOf(scene);
  expect(counted(names, 'assistant_effect_failed')).toBe(1);
  expect(counted(names, 'assistant_turn_finished')).toBe(1);
}

async function withheld(scene: AssistantScene, id: string, result: LoopResult): Promise<void> {
  const events = await assistantLog(scene);
  const failed = events.find((event) => event.name === 'assistant_effect_failed');
  expect(failed?.evidence['why']).toBe('delegation_lapsed');
  const finished = events.find((event) => event.name === 'assistant_turn_finished');
  expect(finished?.evidence['requestId']).toBe(id);
  expect(finished?.evidence['costMicros']).toBe(result.usage.costMicros);
  expect(scene.world.adapters.directMessages.sent()).toEqual([]);
}

async function revokedDuringTurn(scene: AssistantScene): Promise<void> {
  const delegationId = await grantFor(scene, null);
  const { id, turn, result } = await begun(scene, '721');
  const started = (await assistantLog(scene)).find(
    (event) => event.name === 'assistant_turn_started',
  );
  expect(started?.evidence['delegationId']).toBe(delegationId);
  const { world, person } = scene;
  value(await world.kernel.delegations.revoke(simCaller(world, person), { delegationId }));
  const finished = value(await finishWith(scene, id, turn, result));
  expect(finished.delivery).toBe('delegation_lapsed');
  await withheld(scene, id, result);
}

async function expiredDuringTurn(scene: AssistantScene): Promise<void> {
  const { clock } = scene.world.adapters;
  await grantFor(scene, new Date(clock.now().getTime() + HOUR_MS));
  const { id, turn, result } = await begun(scene, '731');
  clock.advance(2 * HOUR_MS);
  const finished = value(await finishWith(scene, id, turn, result));
  expect(finished.delivery).toBe('delegation_lapsed');
  await withheld(scene, id, result);
}

describe('PA-2 the sending attempt owns the reply, and only a live delegation lets it go', () => {
  it('reports a retry during the send as in flight and reuses the settled result after', () =>
    withScene(retryWhileSending));

  it('records outcome_unknown only once the send lease has passed, and the late send delivers nothing', () =>
    withScene(leasePassed));

  it('settles a send held past its send-by time as deadline_passed, delivering nothing', () =>
    withScene(sendWindowPassed));

  it('withholds the reply when assist is revoked during the turn, keeping its usage', () =>
    withScene(revokedDuringTurn));

  it('withholds the reply when assist expires during the turn, keeping its usage', () =>
    withScene(expiredDuringTurn));
});
