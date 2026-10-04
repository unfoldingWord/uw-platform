import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, replay } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller, simIngest } from '../fixtures.ts';
import { detailOf, itemEvents, reasonOf, runWorld, value } from '../runs.ts';
import { commentOn, gatedCheck, parkAtCheck, topicScene, type TopicScene } from '../topics.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

function linkedOn(scene: TopicScene, itemId: string) {
  return itemEvents(scene, itemId).then((events) =>
    events.filter((event) => event.name === 'zulip_topic_linked'),
  );
}

async function topicOf(world: World, itemId: string): Promise<string | null> {
  const item = await world.adapters.store.transaction((tx) => tx.harnessItems.read.byId(itemId));
  return item?.zulipTopic ?? null;
}

async function replayEqualsRow(scene: TopicScene, itemId: string): Promise<void> {
  const { store } = scene.world.adapters;
  const row = await store.transaction((tx) => tx.harnessItems.read.byId(itemId));
  const events = await store.transaction((tx) => readAllEvents(tx, scene.harnessId, itemId));
  expect(replay(events)).toEqual(row);
}

async function oneTopicPerItem(world: World): Promise<void> {
  const scene = await topicScene(world);
  world.adapters.notifier.enableZulip();
  const first = await parkAtCheck(scene, 'Check the copy');
  const topic = 'software/item-00000000';
  expect(world.adapters.notifier.posts().map((post) => post.topic)).toEqual([topic]);
  expect(await topicOf(world, first)).toBe(topic);
  await replayEqualsRow(scene, first);
  value(
    await world.kernel.gates.decide(simCaller(world, scene.areaAdmin), {
      itemId: first,
      decision: 'reject',
      reason: null,
      findings: ['The copy needs a second pass'],
    }),
  );
  await scene.resubmit(first);
  expect(world.adapters.notifier.posts().map((post) => post.topic)).toEqual([topic, topic]);
  expect(await linkedOn(scene, first)).toHaveLength(1);
  const second = await parkAtCheck(scene, 'Check the icon');
  expect(await topicOf(world, second)).toBe('software/item-000000000000');
  const issue = await scene.parkIssue({
    repo: 'unfoldingWord/uw-platform',
    number: 42,
    githubId: 9100000042,
  });
  expect(await topicOf(world, issue)).toBe('software/uw-platform#42');
  expect(world.adapters.notifier.posts().map((post) => post.reason)).not.toContain(
    'stage_advanced',
  );
}

async function lapsePostsToHarness(world: World): Promise<void> {
  const scene = await runWorld(world);
  world.adapters.notifier.enableZulip();
  value(
    await world.kernel.delegations.revoke(simCaller(world, scene.owner), {
      delegationId: scene.delegationId,
    }),
  );
  await world.kernel.delegations.beat(simCaller(world, scene.persona), {
    delegationId: scene.delegationId,
  });
  expect(world.adapters.notifier.posts()).toEqual([
    expect.objectContaining({ topic: 'software', reason: 'delegation_lapsed' }),
  ]);
}

async function outageDropsTheWake(world: World): Promise<void> {
  const scene = await topicScene(world);
  world.adapters.notifier.enableZulip();
  world.adapters.notifier.subscribe(scene.areaAdmin.personId ?? '');
  const itemId = await gatedCheck(scene, 'Check the copy');
  world.adapters.notifier.failNext();
  const caller = simCaller(world, scene.ian);
  value(await world.kernel.items.claim(caller, { itemId, delegationId: null }));
  const submitted = await world.kernel.items.submit(caller, {
    itemId,
    to: null,
    evidence: {},
    change: null,
  });
  expect(value(submitted).result).toBe('parked');
  expect(world.adapters.notifier.posts()).toEqual([]);
  expect(await linkedOn(scene, itemId)).toEqual([]);
  const decisions = world.adapters.notifier.decisions().map((found) => found.decision);
  expect(decisions).toEqual(['dropped']);
}

async function replyIsComment(world: World): Promise<void> {
  const scene = await topicScene(world);
  const itemId = await parkAtCheck(scene, 'Check the copy');
  const ingest = simCaller(world, simIngest());
  const mapped = await commentOn(scene, ingest, itemId, { personId: scene.areaAdmin.personId });
  expect(reasonOf(mapped)).toBeNull();
  value(await commentOn(scene, ingest, itemId, { personId: null, email: 'guest@example.org' }));
  value(await commentOn(scene, ingest, itemId, { text: 'x'.repeat(12_000) }));
  const refused = await commentOn(scene, simCaller(world, scene.ian), itemId, {});
  expect(reasonOf(refused)).toBe('not_permitted');
  const comments = (await itemEvents(scene, itemId)).filter(
    (event) => event.name === 'comment_recorded',
  );
  expect(comments.map((event) => [event.actor, event.evidence['personId']])).toEqual([
    ['agent:ingest', scene.areaAdmin.personId],
    ['agent:ingest', null],
    ['agent:ingest', null],
  ]);
  expect(comments[1]?.evidence['email']).toBe('guest@example.org');
  const long = comments[2]?.evidence;
  expect([String(long?.['text']).length, long?.['truncated']]).toEqual([10_000, true]);
}

async function approveDecidesNothing(world: World): Promise<void> {
  const scene = await topicScene(world);
  const itemId = await parkAtCheck(scene, 'Check the copy');
  const before = await itemEvents(scene, itemId);
  value(await commentOn(scene, simCaller(world, simIngest()), itemId, { text: 'approve' }));
  const after = await itemEvents(scene, itemId);
  expect(after.slice(before.length).map((event) => event.name)).toEqual(['comment_recorded']);
  const item = await world.adapters.store.transaction((tx) => tx.harnessItems.read.byId(itemId));
  expect(item?.gateStatus).toBe('parked');
  const decisions = await world.adapters.store.transaction((tx) =>
    tx.gateDecisions.read.forItem(itemId),
  );
  expect(decisions).toEqual([]);
}

async function targetsByTopic(world: World): Promise<void> {
  const scene = await topicScene(world);
  world.adapters.notifier.enableZulip();
  const itemId = await parkAtCheck(scene, 'Check the copy');
  const ingest = simCaller(world, simIngest());
  const target = (topic: string) => world.kernel.reads.zulipTarget(ingest, { topic });
  expect(value(await target('software/item-00000000'))).toEqual({
    harnessId: scene.harnessId,
    jdArea: '80-89',
    itemId,
  });
  expect(value(await target('SOFTWARE/ITEM-00000000')).itemId).toBe(itemId);
  expect(value(await target('software'))).toEqual({
    harnessId: scene.harnessId,
    jdArea: '80-89',
    itemId: null,
  });
  expect(reasonOf(await target('software/item-ffffffff'))).toBe('item_not_found');
  expect(reasonOf(await target('nowhere/item-00000000'))).toBe('harness_not_found');
  const person = simCaller(world, scene.ian);
  expect(reasonOf(await world.kernel.reads.zulipTarget(person, { topic: 'software' }))).toBe(
    'not_permitted',
  );
  await shareTopic(world, itemId, await parkAtCheck(scene, 'Check the icon'));
  expect(detailOf(await target('software/item-00000000'))).toEqual({
    topic: 'software/item-00000000',
    why: 'ambiguous_topic',
  });
}

async function shareTopic(world: World, holder: string, other: string): Promise<void> {
  await world.adapters.store.transaction(async (tx) => {
    const held = await tx.harnessItems.read.byId(holder);
    const item = await tx.harnessItems.read.byId(other);
    if (held === null || item === null) throw new Error('the items are missing');
    await tx.harnessItems.write.project({ ...item, zulipTopic: held.zulipTopic });
  });
}

describe('the Zulip topic and replies', () => {
  it('NT-3 one topic per item is created on the first wake, stored on the item and kept', () =>
    inWorld(oneTopicPerItem));
  it('NT-3 a harness-level wake posts to the harness topic', () => inWorld(lapsePostsToHarness));
  it('NT-3 a Zulip outage drops the wake and nothing else fails', () =>
    inWorld(outageDropsTheWake));
  it('a reply is recorded as a comment with the person id it is given, or none', () =>
    inWorld(replyIsComment));
  it('NT-3 a reply saying approve is a comment and decides nothing', () =>
    inWorld(approveDecidesNothing));
  it('zulipTarget finds the item by its stored topic, the harness by a bare key, and nothing for an unknown or shared topic', () =>
    inWorld(targetsByTopic));
});
