import assert from 'node:assert/strict';
import { assistantRole, runToolLoop, type ToolCaller, type TurnResult } from '@uw/harness';
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
import { DAY_MS, dueIn, MINUTE_MS } from '../assistant-reminder-fixtures.ts';
import { simCaller, simSystem } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

function hostFor(scene: AssistantScene, id: string, turn: BegunTurn): ToolCaller {
  const { world } = scene;
  return {
    call: async (verb, input) => {
      if (verb !== 'set_reminder') return { output: { error: 'not_offered' }, isError: true };
      const { text, dueAt } = input as { readonly text: string; readonly dueAt: string };
      const drafted = await world.kernel.assistants.setReminder(simCaller(world, turn.principal), {
        requestId: id,
        turnId: turn.turnId,
        text,
        dueAt,
      });
      return { output: drafted, isError: drafted.status !== 'accepted' };
    },
  };
}

function reminderCall(scene: AssistantScene): TurnResult {
  return {
    ...replyWith('', 20_000),
    text: null,
    stopReason: 'tool_use',
    toolCalls: [
      {
        callId: 'call_1',
        verb: 'set_reminder',
        input: { text: 'Call Ana', dueAt: dueIn(scene, DAY_MS) },
      },
    ],
  };
}

async function oneHostedReply(scene: AssistantScene): Promise<readonly string[]> {
  const { world } = scene;
  const id = await requestId(scene, { externalId: '1701', note: 'Remind me to call Ana' });
  const attemptId = world.adapters.ids.next();
  const turn = value(await beginTurn(scene, id, attemptId));
  assert.equal(turn.loop.zeroRetention, true);
  assert.ok(turn.loop.tools.includes('set_reminder'));
  assert.ok(!turn.loop.tools.includes('write_page'));
  world.adapters.modelEngine.respondNextWith(reminderCall(scene));
  world.adapters.modelEngine.respondNextWith(replyWith('I will remind you tomorrow.', 10_000));
  const replay = value(await beginTurn(scene, id, attemptId));
  assert.equal(replay.turnId, turn.turnId);
  const engine = world.adapters.modelEngine.turn;
  const result = await runToolLoop(engine, hostFor(scene, id, replay), replay.loop, async () => {});
  const finish = { requestId: id, turnId: turn.turnId, result };
  value(await world.kernel.assistants.finishTurn(simCaller(world, simSystem()), finish));
  const other = await beginTurn(scene, id);
  assert.equal(other.status, 'error');
  return world.adapters.directMessages.sent().map((message) => message.text);
}

async function crashedTurnClosed(scene: AssistantScene): Promise<unknown> {
  const { world } = scene;
  const id = await requestId(scene, { externalId: '1702', note: 'What is next?' });
  const turn = value(await beginTurn(scene, id));
  world.adapters.clock.advance(61 * MINUTE_MS);
  const swept = value(
    await world.kernel.assistants.closeStaleTurns(simCaller(world, simSystem()), { limit: 50 }),
  );
  assert.deepEqual(swept, { abandoned: [turn.turnId], settled: [], unknown: [] });
  const spent = await world.adapters.store.transaction((tx) =>
    tx.harnessEvents.read.assistantSpend({ harnessId: scene.harness.id, since: new Date(0) }),
  );
  assert.equal(spent.openTurns, 0);
  return swept;
}

export const scenario = defineScenario({
  id: 'PA-17',
  title:
    'a direct message gets one hosted turn: the loop is zero-retention and offered the reminder verbs, a replay of the same attempt is the same turn, another attempt is refused, one reply reaches me; a turn whose host died is closed as abandoned after the hour and its reservation released',
  run: async (world) => {
    const scene = await grantedScene(world);
    const sent = await oneHostedReply(scene);
    assert.deepEqual(sent, ['I will remind you tomorrow.']);
    const swept = await crashedTurnClosed(scene);
    const names = assistantNames(await assistantLog(scene));
    assert.equal(names.filter((name) => name === 'assistant_reminder_set').length, 1);
    return { state: { sent, swept, model: assistantRole.model } };
  },
});
