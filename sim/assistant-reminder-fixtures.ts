import { runToolLoop, type LoopResult, type ToolCaller } from '@uw/harness';
import {
  beginTurn,
  replyWith,
  requestId,
  type AssistantScene,
  type BegunTurn,
  type RequestChange,
} from './assistant-fixtures.ts';
import { simCaller, simSystem } from './fixtures.ts';
import { value } from './runs.ts';

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

const noTools: ToolCaller = {
  call: async () => ({ output: { error: 'not_wired' }, isError: true }),
};

export type OpenTurn = { readonly id: string; readonly turn: BegunTurn };

export async function openTurn(scene: AssistantScene, change: RequestChange): Promise<OpenTurn> {
  const id = await requestId(scene, change);
  return { id, turn: value(await beginTurn(scene, id)) };
}

export function dueIn(scene: AssistantScene, ms: number): string {
  return new Date(scene.world.adapters.clock.now().getTime() + ms).toISOString();
}

export function setReminder(scene: AssistantScene, open: OpenTurn, text: string, dueAt: string) {
  const { world } = scene;
  return world.kernel.assistants.setReminder(simCaller(world, open.turn.principal), {
    requestId: open.id,
    turnId: open.turn.turnId,
    text,
    dueAt,
  });
}

export function cancelReminder(scene: AssistantScene, open: OpenTurn, reminderId: string) {
  const { world } = scene;
  return world.kernel.assistants.cancelReminder(simCaller(world, open.turn.principal), {
    requestId: open.id,
    turnId: open.turn.turnId,
    reminderId,
  });
}

export function listReminders(scene: AssistantScene, open: OpenTurn) {
  const { world } = scene;
  return world.kernel.assistants.listReminders(simCaller(world, open.turn.principal), {
    requestId: open.id,
    turnId: open.turn.turnId,
  });
}

export async function closeTurn(scene: AssistantScene, open: OpenTurn): Promise<LoopResult> {
  const { world } = scene;
  world.adapters.modelEngine.respondNextWith(replyWith('Done.', 10_000));
  const loop = world.adapters.modelEngine.turn;
  const result = await runToolLoop(loop, noTools, open.turn.loop, async () => undefined);
  value(
    await world.kernel.assistants.finishTurn(simCaller(world, simSystem()), {
      requestId: open.id,
      turnId: open.turn.turnId,
      result,
    }),
  );
  return result;
}

export function fireDue(scene: AssistantScene, limit = 50) {
  const { world } = scene;
  return world.kernel.assistants.fireDueReminders(simCaller(world, simSystem()), { limit });
}
