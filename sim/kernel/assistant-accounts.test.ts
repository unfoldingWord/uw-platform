import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import {
  accountEvents,
  disable,
  enable,
  passDays,
  retire,
  seedNumberedPage,
  staffPerson,
} from '../assistant-account-fixtures.ts';
import { grantAssist } from '../assistant-fixtures.ts';
import { simAgent, simCaller, simPerson, simSystem } from '../fixtures.ts';
import { value } from '../runs.ts';
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

async function harnessOf(world: World, harnessId: string) {
  return world.adapters.store.transaction((tx) => tx.harnesses.read.byId(harnessId));
}

async function firstGetsTheFirstNumbers(world: World): Promise<void> {
  const ana = await staffPerson(world, 61);
  const ben = await staffPerson(world, 62);
  const first = value(await enable(world, ana, 'barnabas'));
  const second = value(await enable(world, ben, 'silas'));
  expect([first.jdId, second.jdId]).toEqual(['10.51', '10.52']);
  const harness = await harnessOf(world, first.harnessId);
  expect(harness).toMatchObject({ jdArea: '10-19', title: '10.51 Barnabas' });
  expect(harness?.personId).toBe(ana.personId);
  const names = (await accountEvents(world, first.harnessId)).map((event) => event.name);
  expect(names).toEqual(['assistant_enabled']);
}

async function repeatChangesNothing(world: World): Promise<void> {
  const ana = await staffPerson(world, 61);
  const first = value(await enable(world, ana, 'barnabas'));
  const again = value(await enable(world, ana, 'barnabas'));
  expect(again).toEqual({ ...first, created: false });
  expect(await accountEvents(world, first.harnessId)).toHaveLength(1);
  const renamed = await enable(world, ana, 'silas');
  expect(renamed).toMatchObject({ status: 'error', reason: 'not_permitted' });
}

async function skipsAPageNumber(world: World): Promise<void> {
  await seedNumberedPage(world, '00000000-0000-4000-8000-00000000a051', '10.51 Payroll');
  const ana = await staffPerson(world, 61);
  expect(value(await enable(world, ana, 'barnabas')).jdId).toBe('10.52');
}

async function refusesBadNames(world: World): Promise<void> {
  const ana = await staffPerson(world, 61);
  const ben = await staffPerson(world, 62);
  expect(await enable(world, ana, 'B')).toMatchObject({
    reason: 'malformed_command',
    detail: { field: 'name', why: 'name_invalid' },
  });
  expect(await enable(world, ana, 'postmaster')).toMatchObject({
    reason: 'malformed_command',
    detail: { field: 'name', why: 'name_reserved' },
  });
  value(await enable(world, ana, 'barnabas'));
  expect(await enable(world, ben, 'barnabas')).toMatchObject({
    status: 'error',
    reason: 'assistant_name_taken',
  });
}

async function onlyThePersonThemself(world: World): Promise<void> {
  const ana = await staffPerson(world, 61);
  const nobody = await simPerson(world, 63, []);
  const call = (actor: Parameters<typeof simCaller>[1]) =>
    world.kernel.assistants.enable(simCaller(world, actor), {
      harnessId: world.adapters.ids.next(),
      name: 'barnabas',
    });
  expect(await call(simSystem())).toMatchObject({ reason: 'not_permitted' });
  expect(await call(simAgent(ana, 'iterate', { interactive: true }))).toMatchObject({
    reason: 'not_permitted',
  });
  expect(await call({ ...ana, interactive: false })).toMatchObject({
    reason: 'not_permitted',
  });
  expect(await call(nobody)).toMatchObject({ reason: 'not_permitted' });
}

async function offAndOnKeepsTheNumber(world: World): Promise<void> {
  const ana = await staffPerson(world, 61);
  const on = value(await enable(world, ana, 'barnabas'));
  value(await grantAssist(world, ana, on.harnessId));
  const off = value(await disable(world, ana));
  expect(off).toMatchObject({ harnessId: on.harnessId, revoked: 1 });
  expect(value(await disable(world, ana)).revoked).toBe(0);
  const back = value(await enable(world, ana, 'barnabas'));
  expect(back).toMatchObject({ jdId: '10.51', restored: true, created: false });
  const names = (await accountEvents(world, on.harnessId)).map((event) => event.name);
  expect(names).toEqual(['assistant_enabled', 'assistant_disabled', 'assistant_enabled']);
}

async function offNeedsAnAssistant(world: World): Promise<void> {
  const ana = await staffPerson(world, 61);
  expect(await disable(world, ana)).toMatchObject({ reason: 'no_assistant' });
}

async function newNameWhileOff(world: World): Promise<void> {
  const ana = await staffPerson(world, 61);
  const ben = await staffPerson(world, 62);
  const on = value(await enable(world, ana, 'barnabas'));
  value(await enable(world, ben, 'silas'));
  value(await disable(world, ana));
  expect(await enable(world, ana, 'silas')).toMatchObject({ reason: 'assistant_name_taken' });
  const renamed = value(await enable(world, ana, 'tychicus'));
  expect(renamed).toMatchObject({ jdId: '10.51', name: 'tychicus', restored: true });
  expect(await harnessOf(world, on.harnessId)).toMatchObject({ title: '10.51 Tychicus' });
}

async function deletionFreesTheNumber(world: World): Promise<void> {
  const ana = await staffPerson(world, 61);
  const ben = await staffPerson(world, 62);
  const cy = await staffPerson(world, 64);
  const on = value(await enable(world, ana, 'barnabas'));
  value(await enable(world, ben, 'silas'));
  value(await disable(world, ana));
  passDays(world, 29);
  expect(await retire(world, on.harnessId)).toMatchObject({ reason: 'not_permitted' });
  passDays(world, 1);
  expect(await retire(world, on.harnessId, simSystem())).toMatchObject({
    reason: 'not_permitted',
  });
  expect(value(await retire(world, on.harnessId))).toMatchObject({ jdId: '10.51' });
  expect(value(await enable(world, cy, 'barnabas')).jdId).toBe('10.51');
  const again = value(await enable(world, ana, 'tychicus'));
  expect(again).toMatchObject({ harnessId: on.harnessId, jdId: '10.53', created: false });
  expect(await harnessOf(world, on.harnessId)).toMatchObject({ title: '10.53 Tychicus' });
}

describe('PA-14 a person turns their own assistant on', () => {
  it('gives the first assistant 10.51 in area 10-19 and the next 10.52', () =>
    inWorld(firstGetsTheFirstNumbers));

  it('answers a repeat with the same assistant and records nothing more', () =>
    inWorld(repeatChangesNothing));

  it('skips a number a page in category 10 already holds', () => inWorld(skipsAPageNumber));

  it('refuses an invalid, reserved or taken name', () => inWorld(refusesBadNames));

  it('is the person acting for themself, never an agent, the system or a person without grants', () =>
    inWorld(onlyThePersonThemself));
});

describe('PA-14 a person turns their own assistant off and on', () => {
  it('keeps the JD id and the name, and revokes the live assist delegation', () =>
    inWorld(offAndOnKeepsTheNumber));

  it('refuses to turn off an assistant the person does not have', () =>
    inWorld(offNeedsAnAssistant));
});

describe('PA-14 a new name while turned off', () => {
  it('takes a free name and keeps the JD id, and refuses a taken one', () =>
    inWorld(newNameWhileOff));
});

describe('PA-14 final deletion frees the JD id', () => {
  it('frees the id only 30 days after turning off, and only for the provisioner', () =>
    inWorld(deletionFreesTheNumber));
});
