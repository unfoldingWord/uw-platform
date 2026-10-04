import { gateLink, homeLink, itemLink, type Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { createKernel, software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simParkedAtCheck, simPerson } from '../fixtures.ts';
import {
  beatOf,
  itemEvents,
  itemInScope,
  runWorld,
  startOn,
  stepOn,
  systemCaller,
  value,
  type RunWorld,
} from '../runs.ts';
import {
  beatAs,
  gateScene,
  grantPersona,
  loseAdmin,
  parkAtShip,
  personOf,
  recipientIds,
  wakesFor,
} from '../wakes.ts';
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

const wakeKeys = [
  'at',
  'harnessId',
  'harnessKey',
  'itemId',
  'itemRef',
  'jdArea',
  'link',
  'reason',
  'recipients',
  'topic',
  'traceId',
];

const day = 86_400_000;
const failure = { step: 'work' as const, why: 'retries_exhausted' as const, detail: null };

async function gateReachesDeciders(world: World): Promise<void> {
  const scene = await gateScene(world);
  const standard = await parkAtShip(scene, 'Show the board');
  const [wake] = wakesFor(world, standard).filter((found) => found.reason === 'gate_waiting');
  expect(recipientIds(wake)).toEqual([personOf(scene.ian), personOf(scene.areaAdmin)].toSorted());
  expect(wake?.link).toBe(gateLink(scene.harnessId, standard));
  expect(Object.keys(wake ?? {}).toSorted()).toEqual(wakeKeys);
  const high = await parkAtShip(scene, 'Tighten the access check', ['acl']);
  const [highWake] = wakesFor(world, high).filter((found) => found.reason === 'gate_waiting');
  expect(recipientIds(highWake)).toEqual([personOf(scene.ian)]);
}

function runWakes(scene: RunWorld) {
  return wakesFor(scene.world, scene.itemId).filter((wake) => wake.reason === 'run_failed');
}

async function finalFailureWakesHolder(world: World): Promise<void> {
  const scene = await runWorld(world);
  const { runId } = value(await startOn(scene));
  value(await stepOn(scene, await beatOf(scene), { runId, step: 'work' }));
  expect(runWakes(scene)).toEqual([]);
  value(await world.kernel.runs.fail(systemCaller(scene), runId, failure));
  const wakes = runWakes(scene);
  expect(wakes.map((wake) => [recipientIds(wake), wake.link])).toEqual([
    [[personOf(scene.owner)], itemLink(scene.harnessId, scene.itemId)],
  ]);
}

function lapseWakes(world: World) {
  return world.adapters.notifier.delivered().filter((wake) => wake.reason === 'delegation_lapsed');
}

async function lapseWakesItsPerson(world: World): Promise<void> {
  const scene = await runWorld(world);
  value(
    await world.kernel.delegations.revoke(simCaller(world, scene.owner), {
      delegationId: scene.delegationId,
    }),
  );
  expect(lapseWakes(world)).toEqual([]);
  await world.kernel.delegations.beat(simCaller(world, scene.persona), {
    delegationId: scene.delegationId,
  });
  expect(lapseWakes(world).map((wake) => [recipientIds(wake), wake.link])).toEqual([
    [[personOf(scene.owner)], homeLink],
  ]);
  const kim = await simPerson(world, 9, [
    { role: 'admin', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const delegation = await grantPersona(world, scene.harnessId, kim, 'agent:scout');
  await loseAdmin(world, kim);
  await beatAs(world, kim, delegation);
  const [, lost] = lapseWakes(world);
  expect(recipientIds(lost)).toEqual([personOf(scene.admin), personOf(scene.owner)].toSorted());
}

async function lapseAndFailureShow(world: World): Promise<void> {
  const scene = await runWorld(world);
  const { runId } = value(await startOn(scene));
  const stoppedItem = await itemInScope(scene, 'Stop on the lapse');
  const stopped = value(await startOn(scene, { itemId: stoppedItem }));
  world.adapters.clock.advance(91 * day);
  value(await world.kernel.runs.fail(systemCaller(scene), runId, failure));
  await world.kernel.runs.scene(systemCaller(scene), stopped.runId);
  const home = await world.kernel.views.waitingOn(simCaller(world, scene.owner));
  const kinds = home.rows.map((row) =>
    row.kind === 'delegation_lapsed' ? [row.kind, row.delegation.id] : [row.kind],
  );
  expect(kinds).toContainEqual(['delegation_lapsed', scene.delegationId]);
  expect(kinds).toContainEqual(['run_failed']);
  const failedNames = (await itemEvents(scene, scene.itemId)).map((event) => event.name);
  expect(failedNames).toContain('run_failed');
  const stoppedEvents = await itemEvents(scene, stoppedItem);
  const stop = stoppedEvents.find((event) => event.name === 'run_stopped');
  expect(stop?.evidence['why']).toBe('delegation_lapsed');
}

async function lostGrantShowsOtherAdmins(world: World): Promise<void> {
  const scene = await runWorld(world);
  const kim = await simPerson(world, 9, [
    { role: 'admin', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const delegation = await grantPersona(world, scene.harnessId, kim, 'agent:scout');
  await loseAdmin(world, kim);
  await beatAs(world, kim, delegation);
  const lapsedOn = async (viewer: Principal) =>
    (await world.kernel.views.waitingOn(simCaller(world, viewer))).rows.flatMap((row) =>
      row.kind === 'delegation_lapsed' ? [row.delegation.id] : [],
    );
  expect(await lapsedOn(scene.owner)).toContain(delegation.id);
  expect(await lapsedOn(scene.admin)).toContain(delegation.id);
  const editor = await simPerson(world, 6, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  expect(await lapsedOn(editor)).not.toContain(delegation.id);
}

async function enqueuedBy(world: World, harnessId: string, worker: Principal) {
  const enqueued = await world.kernel.items.enqueue(simCaller(world, worker), {
    harnessId,
    title: 'Scope the copy',
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  return value(enqueued).itemId;
}

async function atScope(world: World, harnessId: string, worker: Principal) {
  const itemId = await enqueuedBy(world, harnessId, worker);
  const editor = simCaller(world, worker);
  value(await world.kernel.items.claim(editor, { itemId, delegationId: null }));
  value(await world.kernel.items.submit(editor, { itemId, to: null, evidence: {}, change: null }));
  return itemId;
}

async function submitAs(world: World, actor: Principal, itemId: string) {
  const caller = simCaller(world, actor);
  value(await world.kernel.items.claim(caller, { itemId, delegationId: null }));
  value(await world.kernel.items.submit(caller, { itemId, to: null, evidence: {}, change: null }));
}

async function advanceWakesHolder(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  const editor = await simPerson(world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const laptop = simAgent(editor, `${personOf(editor)}/laptop`, { interactive: true });
  const byAgent = await atScope(world, harness.id, editor);
  await submitAs(world, laptop, byAgent);
  const agentWakes = wakesFor(world, byAgent).filter((wake) => wake.reason === 'stage_advanced');
  expect(agentWakes.map(recipientIds)).toEqual([[personOf(editor)]]);
  const byPerson = await atScope(world, harness.id, editor);
  await submitAs(world, editor, byPerson);
  expect(wakesFor(world, byPerson)).toEqual([]);
  const own = await simParkedAtCheck(world, { harnessId: harness.id, admin, title: 'Own gate' });
  const [gate] = wakesFor(world, own.itemId).filter((wake) => wake.reason === 'gate_waiting');
  expect(recipientIds(gate)).not.toContain(personOf(admin));
}

async function failureAfterCommit(world: World): Promise<void> {
  const kernel = createKernel({
    ...world.adapters,
    notifier: {
      notify: async () => {
        throw new Error('notifier down');
      },
    },
    hub: {
      ...world.adapters.hub,
      present: async () => {
        throw new Error('hub down');
      },
    },
  });
  const failing = { ...world, kernel };
  const scene = await gateScene(failing);
  const itemId = await parkAtShip(scene, 'Show the board');
  const names = (await itemEvents(scene, itemId)).map((event) => event.name);
  expect(names).toContain('submitted_to_gate');
}

describe('wakes after commit', () => {
  it('NT-2 a gate wake reaches only people who can decide it, with a deep link and no content', () =>
    inWorld(gateReachesDeciders));
  it('NT-4 a final run failure wakes the item holder at the run-failed rank', () =>
    inWorld(finalFailureWakesHolder));
  it('NT-4 a lapsed delegation wakes its person at the top rank, or the area other admins when that person lost the grant', () =>
    inWorld(lapseWakesItsPerson));
  it('NT-4 a lapsed delegation and a failed run appear on Home and on the play-by-play', () =>
    inWorld(lapseAndFailureShow));
  it('NT-4 a lapsed delegation whose person lost the grant appears on Home for every other admin on the area', () =>
    inWorld(lostGrantShowsOtherAdmins));
  it('NT-1 a stage advance wakes only the item holder', () => inWorld(advanceWakesHolder));
  it('a notifier or hub failure after commit leaves the command accepted', () =>
    inWorld(failureAfterCommit));
});
