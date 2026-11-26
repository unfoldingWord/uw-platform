import { closeEmbeddedTemplate } from '@uw/db/embedded';
import type { KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assistantLog,
  assistantScene,
  recordRequest,
  type AssistantScene,
} from '../assistant-fixtures.ts';
import { simCaller, simIngest, simPerson, simSystem } from '../fixtures.ts';
import { value } from '../runs.ts';
import { personOf } from '../wakes.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const MINUTE_MS = 60_000;
const right = 'a'.repeat(64);
const wrong = 'b'.repeat(64);

async function withScene(work: (scene: AssistantScene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await assistantScene(world));
  } finally {
    await world.close();
  }
}

function why(outcome: KernelOutcome<unknown>): unknown {
  return outcome.status === 'error' ? outcome.detail['why'] : outcome.status;
}

function start(scene: AssistantScene, codeDigest = right) {
  return scene.world.kernel.assistants.startPairing(simCaller(scene.world, scene.person), {
    harnessId: scene.harness.id,
    channel: 'zulip_dm',
    codeDigest,
  });
}

function complete(scene: AssistantScene, codeDigest: string, address = 'zulip:6006') {
  return scene.world.kernel.assistants.completePairing(simCaller(scene.world, simIngest()), {
    personId: personOf(scene.person),
    channel: 'zulip_dm',
    address,
    codeDigest,
  });
}

function bindByEmail(scene: AssistantScene, address: string) {
  return scene.world.kernel.assistants.bindAddress(simCaller(scene.world, simSystem()), {
    personId: personOf(scene.person),
    channel: 'zulip_dm',
    address,
  });
}

function bindingOf(scene: AssistantScene) {
  return scene.world.adapters.store.transaction((tx) =>
    tx.assistantBindings.read.of(scene.harness.id, 'zulip_dm'),
  );
}

async function pairingEvents(scene: AssistantScene) {
  return (await assistantLog(scene))
    .filter((event) => event.name.includes('pair'))
    .map((event) => [event.name, event.evidence]);
}

async function bindsTheAddressTheProvisionerFound(scene: AssistantScene): Promise<void> {
  const asIngest = await scene.world.kernel.assistants.bindAddress(
    simCaller(scene.world, simIngest()),
    { personId: personOf(scene.person), channel: 'zulip_dm', address: 'zulip:6006' },
  );
  expect(asIngest.status).toBe('error');
  value(await bindByEmail(scene, 'zulip:6006'));
  expect(await bindingOf(scene)).toMatchObject({ address: 'zulip:6006', via: 'email_match' });
  expect(value(await bindByEmail(scene, 'zulip:7007'))).toEqual({ via: 'email_match' });
  expect(await bindingOf(scene)).toMatchObject({ address: 'zulip:6006' });
  expect(await pairingEvents(scene)).toEqual([
    ['assistant_paired', { channel: 'zulip_dm', via: 'email_match' }],
  ]);
}

async function letsOnlyThePersonStartA(scene: AssistantScene): Promise<void> {
  const stranger = await simPerson(scene.world, 6, [
    { role: 'admin', scopeKind: 'org', scopeArea: null },
  ]);
  const foreign = await scene.world.kernel.assistants.startPairing(
    simCaller(scene.world, stranger),
    { harnessId: scene.harness.id, channel: 'zulip_dm', codeDigest: right },
  );
  expect(why(foreign)).toBe('not_the_person');
  expect(why(await start(scene, 'K7M2Q9XR'))).toBe('code_digest');
  const started = value(await start(scene));
  expect(started.expiresAt.getTime() - scene.world.adapters.clock.now().getTime()).toBe(
    10 * MINUTE_MS,
  );
  expect(await pairingEvents(scene)).toEqual([
    ['assistant_pairing_started', { channel: 'zulip_dm' }],
  ]);
}

async function pairsOnTheRightCodeOnce(scene: AssistantScene): Promise<void> {
  expect(why(await complete(scene, right))).toBe('no_pairing');
  value(await start(scene));
  expect(why(await complete(scene, wrong))).toBe('pairing_code_wrong');
  expect(value(await complete(scene, right))).toEqual({ via: 'pairing_code' });
  expect(await bindingOf(scene)).toMatchObject({ address: 'zulip:6006', via: 'pairing_code' });
  expect(why(await complete(scene, right))).toBe('no_pairing');
  value(await start(scene));
  scene.world.adapters.clock.advance(10 * MINUTE_MS);
  expect(why(await complete(scene, right, 'zulip:7007'))).toBe('pairing_code_expired');
  expect(await bindingOf(scene)).toMatchObject({ address: 'zulip:6006' });
}

async function spendsTheCodeAfterFiveWrong(scene: AssistantScene): Promise<void> {
  value(await start(scene));
  const answers = [];
  for (let n = 0; n < 5; n += 1) answers.push(why(await complete(scene, wrong)));
  expect(answers).toEqual([
    'pairing_code_wrong',
    'pairing_code_wrong',
    'pairing_code_wrong',
    'pairing_code_wrong',
    'pairing_attempts_spent',
  ]);
  expect(why(await complete(scene, right))).toBe('no_pairing');
  expect(await bindingOf(scene)).toBeNull();
}

async function neverGivesOneZulipAccountTo(scene: AssistantScene): Promise<void> {
  value(await bindByEmail(scene, 'zulip:6006'));
  const other = await simPerson(scene.world, 7, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '10-19' },
  ]);
  const { harness } = value(
    await scene.world.kernel.assistants.provision(simCaller(scene.world, scene.rowan), {
      harnessId: scene.world.adapters.ids.next(),
      personId: personOf(other),
    }),
  );
  const taken = await scene.world.kernel.assistants.bindAddress(
    simCaller(scene.world, simSystem()),
    { personId: personOf(other), channel: 'zulip_dm', address: 'zulip:6006' },
  );
  expect(why(taken)).toBe('address_taken');
  const stored = await scene.world.adapters.store.transaction((tx) =>
    tx.assistantBindings.read.of(harness.id, 'zulip_dm'),
  );
  expect(stored).toBeNull();
}

async function refusesTheThirtyFirstRequestWithin(scene: AssistantScene): Promise<void> {
  for (let n = 0; n < 30; n += 1) {
    value(await recordRequest(scene, { externalId: `rate-${String(n)}`, note: 'Hi' }));
  }
  const capped = await recordRequest(scene, { externalId: 'rate-30', note: 'Hi' });
  expect(why(capped)).toBe('requests_capped');
  scene.world.adapters.clock.advance(61 * MINUTE_MS);
  expect(value(await recordRequest(scene, { externalId: 'rate-31', note: 'Hi' })).created).toBe(
    true,
  );
}

describe('PA-6 pairing a Zulip account with its assistant', () => {
  it('binds the address the provisioner found by email, for the system only', () =>
    withScene(bindsTheAddressTheProvisionerFound));

  it('lets only the person start a pairing on their own assistant', () =>
    withScene(letsOnlyThePersonStartA));

  it('pairs on the right code once, and refuses a wrong, reused or expired one', () =>
    withScene(pairsOnTheRightCodeOnce));

  it('spends the code after five wrong attempts', () => withScene(spendsTheCodeAfterFiveWrong));

  it("never gives one Zulip account to two people's assistants", () =>
    withScene(neverGivesOneZulipAccountTo));
});

describe('PA-6 an assistant takes at most thirty requests an hour', () => {
  it('refuses the thirty-first request within the hour and takes one after it', () =>
    withScene(refusesTheThirtyFirstRequestWithin));
});
