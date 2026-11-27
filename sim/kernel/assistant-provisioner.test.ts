import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import {
  accountEvents,
  enable,
  simProvisioner,
  staffPerson,
} from '../assistant-account-fixtures.ts';
import { seedAssistantPersona } from '../assistant-fixtures.ts';
import { simCaller, simSystem } from '../fixtures.ts';
import { pageStatus } from '../persona-fixtures.ts';
import { value } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const draftPage = '00000000-0000-4000-8000-00000000c601';
const otherDraft = '00000000-0000-4000-8000-00000000c602';

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

async function enabledHarness(world: World, n: number, name: string) {
  const person = await staffPerson(world, n);
  const { harnessId } = value(await enable(world, person, name));
  const harness = await world.adapters.store.transaction((tx) => tx.harnesses.read.byId(harnessId));
  if (harness === null) throw new Error('the assistant harness was not made');
  return { person, harness };
}

async function provisionerActivatesThePersona(world: World): Promise<void> {
  const { person, harness } = await enabledHarness(world, 61, 'barnabas');
  await seedAssistantPersona(world, harness, person, { id: draftPage, status: 'suggested' });
  const input = { harnessId: harness.id, pageId: draftPage, expectedVersion: 1 };
  const asSystem = simCaller(world, simSystem());
  const asPerson = simCaller(world, person);
  expect(await world.kernel.assistants.activatePersona(asSystem, input)).toMatchObject({
    reason: 'not_permitted',
  });
  expect(await world.kernel.assistants.activatePersona(asPerson, input)).toMatchObject({
    reason: 'not_permitted',
  });
  const asProvisioner = simCaller(world, simProvisioner());
  const activated = value(await world.kernel.assistants.activatePersona(asProvisioner, input));
  expect(activated.harnessId).toBe(harness.id);
  expect(await pageStatus(world, draftPage)).toBe('active');
}

async function refusesAnotherHarnessPersona(world: World): Promise<void> {
  const ana = await enabledHarness(world, 61, 'barnabas');
  const ben = await enabledHarness(world, 62, 'silas');
  await seedAssistantPersona(world, ben.harness, ben.person, {
    id: otherDraft,
    status: 'suggested',
  });
  const asProvisioner = simCaller(world, simProvisioner());
  const input = { harnessId: ana.harness.id, pageId: otherDraft, expectedVersion: 1 };
  expect(await world.kernel.assistants.activatePersona(asProvisioner, input)).toMatchObject({
    reason: 'page_not_found',
  });
}

async function recordsStepsOnlyAsProvisioner(world: World): Promise<void> {
  const { harness } = await enabledHarness(world, 61, 'barnabas');
  const record = world.kernel.assistants.recordProvisioning;
  const failure = { harnessId: harness.id, step: 'workspace_user', why: 'name_taken' } as const;
  expect(await record(simCaller(world, simSystem()), failure)).toMatchObject({
    reason: 'not_permitted',
  });
  value(await record(simCaller(world, simProvisioner()), failure));
  value(
    await record(simCaller(world, simProvisioner()), { harnessId: harness.id, done: 'enabled' }),
  );
  const events = await accountEvents(world, harness.id);
  expect(events.map((event) => [event.name, event.evidence])).toEqual([
    ['assistant_enabled', { jdId: '10.51', restored: false }],
    ['assistant_provisioning_failed', { step: 'workspace_user', why: 'name_taken' }],
    ['assistant_provisioned', { goal: 'enabled' }],
  ]);
}

describe('PA-14 the provisioner activates the assistant persona and records its steps', () => {
  it('activates the suggested persona through the dry run, and only as the provisioner', () =>
    inWorld(provisionerActivatesThePersona));

  it('refuses a persona page that belongs to another assistant harness', () =>
    inWorld(refusesAnotherHarnessPersona));

  it('records a step failure with its closed reason and a reached goal, only as the provisioner', () =>
    inWorld(recordsStepsOnlyAsProvisioner));
});
