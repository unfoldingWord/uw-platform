import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { seedPersonStatus } from '@uw/db/test-seed';
import type { Principal } from '@uw/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import {
  accountEvents,
  enable,
  simProvisioner,
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

function sweep(world: World, actor: Principal = simProvisioner()) {
  return world.kernel.assistants.disableLeavers(simCaller(world, actor), { limit: 10 });
}

function turnOffFor(world: World, actor: Principal, personId: string) {
  return world.kernel.assistants.disableFor(simCaller(world, actor), { personId });
}

async function statusOf(world: World, personId: string) {
  const row = await world.adapters.store.transaction((tx) =>
    tx.assistantAccounts.read.byPerson(personId),
  );
  return row?.status ?? null;
}

async function twoAssistants(world: World) {
  const ana = await staffPerson(world, 61);
  const ben = await staffPerson(world, 62);
  const anas = value(await enable(world, ana, 'barnabas'));
  const bens = value(await enable(world, ben, 'silas'));
  value(await grantAssist(world, ana, anas.harnessId));
  value(await grantAssist(world, ben, bens.harnessId));
  return { ana, ben, harnessId: anas.harnessId };
}

async function leaverIsTurnedOff(world: World): Promise<void> {
  const { ana, ben, harnessId } = await twoAssistants(world);
  expect(value(await sweep(world)).disabled).toEqual([]);
  await seedPersonStatus(world.database.db, ana.personId ?? '', 'disabled');
  expect(value(await sweep(world)).disabled).toEqual([{ harnessId, revoked: 1 }]);
  expect(await statusOf(world, ana.personId ?? '')).toBe('disabled');
  expect(await statusOf(world, ben.personId ?? '')).toBe('enabled');
  const names = (await accountEvents(world, harnessId)).map((event) => event.name);
  expect(names).toEqual(['assistant_enabled', 'assistant_disabled']);
  expect(value(await sweep(world)).disabled).toEqual([]);
}

async function onlyTheProvisionerSweeps(world: World): Promise<void> {
  const { ana } = await twoAssistants(world);
  await seedPersonStatus(world.database.db, ana.personId ?? '', 'disabled');
  expect(await sweep(world, simSystem())).toMatchObject({ reason: 'not_permitted' });
  const admin = await simPerson(world, 70, [{ role: 'admin', scopeKind: 'org', scopeArea: null }]);
  expect(await sweep(world, admin)).toMatchObject({ reason: 'not_permitted' });
  expect(await statusOf(world, ana.personId ?? '')).toBe('enabled');
}

async function anOrgAdminTurnsAnyoneOff(world: World): Promise<void> {
  const { ana, ben, harnessId } = await twoAssistants(world);
  const admin = await simPerson(world, 70, [{ role: 'admin', scopeKind: 'org', scopeArea: null }]);
  const anaId = ana.personId ?? '';
  expect(await turnOffFor(world, ben, anaId)).toMatchObject({ reason: 'not_permitted' });
  const agent = simAgent(admin, 'iterate', { interactive: true });
  expect(await turnOffFor(world, agent, anaId)).toMatchObject({ reason: 'not_permitted' });
  expect(value(await turnOffFor(world, admin, anaId))).toEqual({ harnessId, revoked: 1 });
  expect(await statusOf(world, anaId)).toBe('disabled');
  expect(value(await turnOffFor(world, admin, anaId)).revoked).toBe(0);
  expect(await turnOffFor(world, admin, admin.personId ?? '')).toMatchObject({
    reason: 'no_assistant',
  });
  expect(value(await enable(world, ana, 'barnabas'))).toMatchObject({ restored: true });
}

describe('PA-20 a person who leaves loses their assistant', () => {
  it('turns off the assistant of a person no longer active and revokes its permission, once', () =>
    inWorld(leaverIsTurnedOff));

  it('is swept only by the provisioner', () => inWorld(onlyTheProvisionerSweeps));
});

describe('PA-20 an org admin turns off any assistant', () => {
  it('turns off and revokes for an org admin, and refuses anyone else or an agent', () =>
    inWorld(anOrgAdminTurnsAnyoneOff));
});
