import { identitySchema, type EventName, type NewHarnessEvent } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
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
import { value } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const BATCH = 500;

async function withScene(work: (scene: AssistantScene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await grantedScene(world));
  } finally {
    await world.close();
  }
}

function otherTraffic(
  scene: AssistantScene,
  name: EventName,
  evidence: () => NewHarnessEvent['evidence'],
): NewHarnessEvent {
  const { ids, clock } = scene.world.adapters;
  return {
    eventId: ids.next(),
    harnessId: scene.harness.id,
    itemId: null,
    name,
    at: clock.now().toISOString(),
    actor: identitySchema.parse('agent:ingest'),
    evidence: { ...evidence() },
    traceId: ids.next(),
    requestId: null,
  };
}

async function appendMany(
  scene: AssistantScene,
  count: number,
  events: () => readonly NewHarnessEvent[],
) {
  for (let done = 0; done < count; done += BATCH) {
    const batch = Array.from({ length: Math.min(BATCH, count - done) }, events).flat();
    await scene.world.adapters.store.transaction((tx) => tx.harnessEvents.write.append(batch));
  }
}

function turnElsewhere(scene: AssistantScene): readonly NewHarnessEvent[] {
  const { ids } = scene.world.adapters;
  const requestId = ids.next();
  const turnId = ids.next();
  const started = otherTraffic(scene, 'assistant_turn_started', () => ({
    requestId,
    turnId,
    attemptId: ids.next(),
    delegationId: ids.next(),
    personaVersion: 1,
  }));
  const finished = otherTraffic(scene, 'assistant_turn_finished', () => ({
    requestId,
    turnId,
    outcome: 'ended',
    turns: 1,
    inputTokens: 10,
    outputTokens: 5,
    costMicros: 0,
    tools: [],
  }));
  return [started, finished];
}

function finishedAt(scene: AssistantScene, costMicros: number): NewHarnessEvent {
  const { ids } = scene.world.adapters;
  return otherTraffic(scene, 'assistant_turn_finished', () => ({
    requestId: ids.next(),
    turnId: ids.next(),
    outcome: 'ended',
    turns: 1,
    inputTokens: 10,
    outputTokens: 5,
    costMicros,
    tools: [],
  }));
}

async function delayedAfterOtherTraffic(scene: AssistantScene): Promise<void> {
  const id = await requestId(scene, { externalId: '501', note: 'Delayed' });
  scene.world.adapters.clock.advance(1_000);
  await appendMany(scene, 5_000, () => turnElsewhere(scene));
  const turn = value(await beginTurn(scene, id));
  scene.world.adapters.modelEngine.respondNextWith(replyWith('On time.', 20_000));
  await finishTurn(scene, id, turn);
  const texts = scene.world.adapters.directMessages.sent().map((sent) => sent.text);
  expect(texts).toEqual(['On time.']);
}

async function spentInMicros(scene: AssistantScene): Promise<void> {
  await appendMany(scene, 4_999, () => [finishedAt(scene, 4_999)]);
  const id = await requestId(scene, { externalId: '511', note: 'One more?' });
  const outcome = await beginTurn(scene, id);
  expect(refusedWhy(outcome, await assistantLog(scene))).toBe('assistant_budget_spent');
}

describe('PA-2 PA-3 an assistant request reads only its own lifecycle and the month in micros', () => {
  it(
    'begins and finishes a delayed request after five thousand turns of other requests',
    () => withScene(delayedAfterOtherTraffic),
    120_000,
  );

  it(
    'spends the month on 4,999 turns of 4,999 micros, though each rounds to no minor unit',
    () => withScene(spentInMicros),
    120_000,
  );
});
