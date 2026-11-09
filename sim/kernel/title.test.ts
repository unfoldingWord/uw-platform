import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Work = (world: World) => Promise<void>;

async function inWorld(work: Work): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

async function titleSets(world: World, harnessId: string) {
  const events = await world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, null));
  return events.filter((event) => event.name === 'title_set').map((event) => event.evidence);
}

function readHarness(world: World, harnessId: string) {
  return world.adapters.store.transaction((tx) => tx.harnesses.read.byId(harnessId));
}

const titledOnActivation: Work = async (world) => {
  const plain = await createSimHarness(world, software, { key: 'software' });
  expect(plain.harness).toMatchObject({ key: 'software', title: 'software' });
  const named = await createSimHarness(world, software, { key: 'bml', title: 'BML' });
  expect(named.harness).toMatchObject({ key: 'bml', title: 'BML' });
  expect((await readHarness(world, named.harness.id))?.title).toBe('BML');
};

const setOnce: Work = async (world) => {
  const { harness, admin } = await createSimHarness(world, software);
  const input = { harnessId: harness.id, title: '  Software  ' };
  expect(await world.kernel.stages.setTitle(simCaller(world, admin), input)).toMatchObject({
    status: 'accepted',
    value: { harness: { key: 'software', title: 'Software' } },
  });
  await world.kernel.stages.setTitle(simCaller(world, admin), input);
  expect(await titleSets(world, harness.id)).toEqual([{ from: 'software', to: 'Software' }]);
};

const onlyAdmins: Work = async (world) => {
  const { harness, admin } = await createSimHarness(world, software);
  const editor = await simPerson(world, 7, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const agent = simAgent(admin, `${admin.personId ?? ''}/builder`, { interactive: true });
  const input = { harnessId: harness.id, title: 'Renamed' };
  for (const actor of [editor, agent]) {
    const outcome = await world.kernel.stages.setTitle(simCaller(world, actor), input);
    expect(outcome.status).toBe('error');
  }
  expect(await titleSets(world, harness.id)).toEqual([]);
};

const malformedRefused: Work = async (world) => {
  const { harness, admin } = await createSimHarness(world, software);
  for (const title of ['   ', 'x'.repeat(81)]) {
    const input = { harnessId: harness.id, title };
    const outcome = await world.kernel.stages.setTitle(simCaller(world, admin), input);
    expect(outcome).toMatchObject({ status: 'error', reason: 'malformed_command' });
  }
  expect(await readHarness(world, harness.id)).toMatchObject({
    key: 'software',
    title: 'software',
  });
};

describe('UI-18 a harness has a display name beside its key', () => {
  it('UI-18 activation without a title takes the key, and with one keeps it', () =>
    inWorld(titledOnActivation));
  it('UI-18 an admin sets the title once, recording title_set with the old and new title', () =>
    inWorld(setOnce));
  it('UI-18 set_title is refused to an agent and to a person who is not an admin', () =>
    inWorld(onlyAdmins));
  it('UI-18 an empty or overlong title is refused, and the key never changes', () =>
    inWorld(malformedRefused));
});
