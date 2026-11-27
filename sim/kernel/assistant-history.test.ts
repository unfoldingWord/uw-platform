import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import {
  beginTurn,
  finishTurn,
  grantedScene,
  replyWith,
  requestId,
  type AssistantScene,
  type RequestChange,
} from '../assistant-fixtures.ts';
import { value } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function withScene(work: (scene: AssistantScene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await grantedScene(world));
  } finally {
    await world.close();
  }
}

async function answered(scene: AssistantScene, change: RequestChange, reply: string) {
  const id = await requestId(scene, change);
  const turn = value(await beginTurn(scene, id));
  scene.world.adapters.modelEngine.respondNextWith(replyWith(reply, 20_000));
  await finishTurn(scene, id, turn);
  scene.world.adapters.clock.advance(1_000);
  return id;
}

async function historyOf(scene: AssistantScene, id: string) {
  return value(await beginTurn(scene, id)).loop.history;
}

const exchange = (note: string, reply: string) => [
  { role: 'user', text: note },
  { role: 'assistant', text: reply, toolCalls: [] },
];

describe('PA-2 an assistant thread carries only its own delivered, earlier exchanges', () => {
  it('keeps a zulip exchange out of an email request with the same literal thread key', () =>
    withScene(async (scene) => {
      await answered(scene, { externalId: '401', note: 'Zulip question', threadKey: 't' }, 'Z');
      const email = await requestId(scene, {
        externalId: '<402@mail.example>',
        note: 'Email question',
        channel: 'email',
        threadKey: 't',
        replyAddress: 'p5@example.org',
      });
      const zulip = await requestId(scene, { externalId: '403', note: 'Next', threadKey: 't' });
      expect(await historyOf(scene, email)).toEqual([]);
      expect(await historyOf(scene, zulip)).toEqual(exchange('Zulip question', 'Z'));
    }));

  it('leaves a dropped reply out of the next request in the thread', () =>
    withScene(async (scene) => {
      scene.world.adapters.directMessages.failNextWith('dropped');
      await answered(scene, { externalId: '411', note: 'Lost question', threadKey: 'd' }, 'Lost');
      const next = await requestId(scene, { externalId: '412', note: 'Again?', threadKey: 'd' });
      expect(await historyOf(scene, next)).toEqual([]);
    }));

  it('gives a delayed request the delivered exchanges before it, despite twelve newer requests', () =>
    withScene(async (scene) => {
      await answered(scene, { externalId: '421', note: 'Early', threadKey: 'late' }, 'Early reply');
      const delayed = await requestId(scene, {
        externalId: '422',
        note: 'Late',
        threadKey: 'late',
      });
      for (let n = 0; n < 12; n += 1) {
        scene.world.adapters.clock.advance(1_000);
        await requestId(scene, { externalId: `43${String(n)}`, note: 'Newer', threadKey: 'late' });
      }
      expect(await historyOf(scene, delayed)).toEqual(exchange('Early', 'Early reply'));
    }));
});
