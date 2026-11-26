import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assistantScene,
  beginTurn,
  grantedScene,
  requestId,
  type AssistantScene,
} from '../assistant-fixtures.ts';
import { simCaller, simPerson, simSystem } from '../fixtures.ts';
import { value } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const MINUTE_MS = 60_000;

async function withWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

function unstarted(scene: AssistantScene) {
  const { world } = scene;
  return world.kernel.assistants.unstartedRequests(simCaller(world, simSystem()), { limit: 50 });
}

async function listsOnlyTheUnstarted(world: World): Promise<void> {
  const scene = await grantedScene(world);
  const waiting = await requestId(scene, { externalId: '1901', note: 'First' });
  const begun = await requestId(scene, { externalId: '1902', note: 'Second' });
  value(await beginTurn(scene, begun));
  expect(value(await unstarted(scene))).toEqual({ requestIds: [] });
  world.adapters.clock.advance(3 * MINUTE_MS);
  expect(value(await unstarted(scene))).toEqual({ requestIds: [waiting] });
  world.adapters.clock.advance(25 * 60 * MINUTE_MS);
  expect(value(await unstarted(scene))).toEqual({ requestIds: [] });
}

async function leavesARefusedRequest(world: World): Promise<void> {
  const scene = await assistantScene(world);
  const refused = await requestId(scene, { externalId: '1903', note: 'No delegation yet' });
  expect((await beginTurn(scene, refused)).status).toBe('error');
  world.adapters.clock.advance(3 * MINUTE_MS);
  expect(value(await unstarted(scene))).toEqual({ requestIds: [] });
}

async function onlyTheSystem(world: World): Promise<void> {
  const person = await simPerson(world, 7, []);
  const asked = await world.kernel.assistants.unstartedRequests(simCaller(world, person), {
    limit: 5,
  });
  expect(asked).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const bounded = await world.kernel.assistants.unstartedRequests(simCaller(world, simSystem()), {
    limit: 0,
  });
  expect(bounded).toMatchObject({ status: 'error', reason: 'malformed_command' });
}

describe('PA-17 a recorded request whose turn never started is found again', () => {
  it('lists a request with no turn two minutes after it was recorded, for a day', () =>
    withWorld(listsOnlyTheUnstarted));

  it('leaves out a request whose turn was refused', () => withWorld(leavesARefusedRequest));

  it('answers only the system, at most two hundred a pass', () => withWorld(onlyTheSystem));
});
