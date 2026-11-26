import { assistantIdentityOf, identitySchema, type NewHarnessEvent } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { assistantRole, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assistantLog,
  beginTurn,
  finishTurn,
  grantedScene,
  refusedWhy,
  replyWith,
  requestId,
  type AssistantScene,
} from '../assistant-fixtures.ts';
import { simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import { personOf } from '../wakes.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const MICROS_PER_MINOR = 10_000;
const budgetMicros = assistantRole.budget.monthly_minor * MICROS_PER_MINOR;
const reservationMicros = assistantRole.turnCeilingMinor * MICROS_PER_MINOR;

async function withScene(work: (scene: AssistantScene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await grantedScene(world));
  } finally {
    await world.close();
  }
}

function earlierTurn(scene: AssistantScene, costMicros: number): NewHarnessEvent {
  const { ids, clock } = scene.world.adapters;
  return {
    eventId: ids.next(),
    harnessId: scene.harness.id,
    itemId: null,
    name: 'assistant_turn_finished',
    at: clock.now().toISOString(),
    actor: identitySchema.parse(assistantIdentityOf(personOf(scene.person))),
    evidence: {
      requestId: ids.next(),
      turnId: ids.next(),
      outcome: 'ended',
      turns: 1,
      inputTokens: 1,
      outputTokens: 1,
      costMicros,
      tools: [],
    },
    traceId: ids.next(),
    requestId: null,
  };
}

async function spend(scene: AssistantScene, costMicros: number): Promise<void> {
  await scene.world.adapters.store.transaction((tx) =>
    tx.harnessEvents.write.append([earlierTurn(scene, costMicros)]),
  );
}

async function startedCount(scene: AssistantScene, id: string): Promise<number> {
  const events = await assistantLog(scene);
  return events.filter(
    (event) => event.name === 'assistant_turn_started' && event.evidence['requestId'] === id,
  ).length;
}

async function openTurns(scene: AssistantScene): Promise<number> {
  const spent = await scene.world.adapters.store.transaction((tx) =>
    tx.harnessEvents.read.assistantSpend({ harnessId: scene.harness.id, since: new Date(0) }),
  );
  return spent.openTurns;
}

async function roomForOne(scene: AssistantScene): Promise<void> {
  await spend(scene, budgetMicros - reservationMicros);
  const first = await requestId(scene, { externalId: '601', note: 'First' });
  const second = await requestId(scene, { externalId: '602', note: 'Second' });
  const turn = value(await beginTurn(scene, first));
  const refusedOutcome = await beginTurn(scene, second);
  expect(refusedWhy(refusedOutcome, await assistantLog(scene))).toBe('assistant_budget_spent');
  scene.world.adapters.modelEngine.respondNextWith(replyWith('Done.', 100_000));
  await finishTurn(scene, first, turn);
  const third = await requestId(scene, { externalId: '603', note: 'Third' });
  expect((await beginTurn(scene, third)).status).toBe('accepted');
}

async function replayed(scene: AssistantScene): Promise<void> {
  const id = await requestId(scene, { externalId: '611', note: 'Lost response' });
  const attempt = scene.world.adapters.ids.next();
  const first = value(await beginTurn(scene, id, attempt));
  scene.world.adapters.clock.advance(1_000);
  const again = value(await beginTurn(scene, id, attempt));
  expect(again.turnId).toBe(first.turnId);
  expect(again.loop.prompt).toBe(first.loop.prompt);
  expect(await startedCount(scene, id)).toBe(1);
  expect(await openTurns(scene)).toBe(1);
  await finishTurn(scene, id, again);
  const after = await beginTurn(scene, id);
  expect(refusedWhy(after, await assistantLog(scene))).toBe('turn_taken');
  expect(await startedCount(scene, id)).toBe(1);
}

async function duplicateRefused(scene: AssistantScene): Promise<void> {
  const id = await requestId(scene, { externalId: '612', note: 'Delivered twice' });
  const { ids } = scene.world.adapters;
  const outcomes = await Promise.all([
    beginTurn(scene, id, ids.next()),
    beginTurn(scene, id, ids.next()),
  ]);
  expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['accepted', 'error']);
  const refusedOutcome = outcomes.find((outcome) => outcome.status === 'error');
  expect(refusedOutcome && refusedWhy(refusedOutcome, await assistantLog(scene))).toBe(
    'turn_taken',
  );
  expect(await startedCount(scene, id)).toBe(1);
  expect(await openTurns(scene)).toBe(1);
}

async function closedWithoutUsage(scene: AssistantScene, turnId: string): Promise<void> {
  const finished = (await assistantLog(scene)).filter(
    (event) => event.name === 'assistant_turn_finished' && event.evidence['turnId'] === turnId,
  );
  expect(
    finished.map((event) => [event.evidence['outcome'], event.evidence['costMicros']]),
  ).toEqual([['refused', 0]]);
  expect(await openTurns(scene)).toBe(0);
}

async function replayRefused(
  scene: AssistantScene,
  externalId: string,
  change: () => Promise<void>,
): Promise<KernelOutcome<unknown>> {
  const id = await requestId(scene, { externalId, note: 'Lost, then changed' });
  const attempt = scene.world.adapters.ids.next();
  const first = value(await beginTurn(scene, id, attempt));
  await change();
  const again = await beginTurn(scene, id, attempt);
  expect(again.status === 'error' && again.detail['turnId']).toBe(first.turnId);
  await closedWithoutUsage(scene, first.turnId);
  return again;
}

async function replayAfterPause(scene: AssistantScene): Promise<void> {
  const again = await replayRefused(scene, '613', async () => {
    value(await pauseCommand(scene, true));
  });
  expect(refusedWhy(again, await assistantLog(scene))).toBe('harness_paused');
}

async function replayAfterRevoke(scene: AssistantScene): Promise<void> {
  const { world, person } = scene;
  const delegationId = (await assistantLog(scene)).find(
    (event) => event.name === 'delegation_granted',
  )?.evidence['delegationId'];
  expect(typeof delegationId).toBe('string');
  const again = await replayRefused(scene, '614', async () => {
    value(
      await world.kernel.delegations.revoke(simCaller(world, person), {
        delegationId: String(delegationId),
      }),
    );
  });
  expect(refusedWhy(again, await assistantLog(scene))).toBe('delegation_required');
}

function pauseCommand(scene: AssistantScene, paused: boolean) {
  const { world, rowan, harness } = scene;
  const input = { harnessId: harness.id, stageKey: null };
  const caller = simCaller(world, rowan);
  return paused
    ? world.kernel.stages.pause(caller, input)
    : world.kernel.stages.resume(caller, input);
}

async function pausedThenResumed(scene: AssistantScene): Promise<void> {
  value(await pauseCommand(scene, true));
  const id = await requestId(scene, { externalId: '621', note: 'While paused' });
  const pending = scene.world.adapters.modelEngine.pending();
  const outcome = await beginTurn(scene, id);
  expect(refusedWhy(outcome, await assistantLog(scene))).toBe('harness_paused');
  expect(await startedCount(scene, id)).toBe(0);
  value(await pauseCommand(scene, false));
  expect((await beginTurn(scene, id)).status).toBe('accepted');
  expect(scene.world.adapters.modelEngine.pending()).toBe(pending);
}

describe('PA-3 an assistant admits a turn once, against a reserved budget, only while running', () => {
  it('reserves an admitted turn, so the second of two with room for one is refused', () =>
    withScene(roomForOne));

  it('replays the same turn for a lost start response and never starts a second', () =>
    withScene(replayed));

  it('refuses a turn while the harness is paused and admits it again after resume', () =>
    withScene(pausedThenResumed));

  it('admits one of two attempts on the same request and refuses the other turn_taken', () =>
    withScene(duplicateRefused));

  it('closes a replayed turn refused after a pause, returning its turn id', () =>
    withScene(replayAfterPause));

  it('closes a replayed turn refused after its delegation is revoked, returning its turn id', () =>
    withScene(replayAfterRevoke));
});
