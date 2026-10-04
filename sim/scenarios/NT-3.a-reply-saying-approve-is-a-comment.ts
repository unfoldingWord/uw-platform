import assert from 'node:assert/strict';
import { simCaller, simIngest } from '../fixtures.ts';
import { itemEvents, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { commentOn } from '../topics.ts';
import { gateScene, parkAtShip, personOf } from '../wakes.ts';

export const scenario = defineScenario({
  id: 'NT-3',
  title:
    'a gate wake posts once to the item topic and links it on the item; a reply saying approve, from a mapped person or an unknown address, is a comment and decides nothing',
  run: async (world) => {
    world.adapters.notifier.enableZulip();
    const scene = await gateScene(world);
    const itemId = await parkAtShip(scene, 'Show the board');
    const read = () =>
      world.adapters.store.transaction(async (tx) => ({
        item: await tx.harnessItems.read.byId(itemId),
        decisions: await tx.gateDecisions.read.forItem(itemId),
      }));
    const topic = (await read()).item?.zulipTopic ?? null;
    assert.deepEqual(
      world.adapters.notifier.posts().map((post) => post.topic),
      [topic],
    );
    const ingest = simCaller(world, simIngest());
    const reply = { text: 'approve', topic: topic ?? '' };
    value(
      await commentOn(scene, ingest, itemId, { ...reply, personId: personOf(scene.areaAdmin) }),
    );
    value(await commentOn(scene, ingest, itemId, { ...reply, email: 'guest@example.org' }));
    const after = await read();
    assert.equal(after.item?.gateStatus, 'parked');
    assert.deepEqual(after.decisions, []);
    const comments = (await itemEvents(scene, itemId))
      .filter((event) => event.name === 'comment_recorded')
      .map((event) => ({ actor: event.actor, personId: event.evidence['personId'] ?? null }));
    assert.deepEqual(comments, [
      { actor: 'agent:ingest', personId: personOf(scene.areaAdmin) },
      { actor: 'agent:ingest', personId: null },
    ]);
    return { state: { topic, comments, gateStatus: after.item?.gateStatus ?? null } };
  },
});
