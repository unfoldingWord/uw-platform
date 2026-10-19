import type { Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { createKernel, notWiredCall, software, type Connectors } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simSeenHead } from '../fixtures.ts';
import {
  approvedBy,
  greenFacts,
  simAtShip,
  simLendMerge,
  standardChange,
  type MergeLoan,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly admin: Principal;
  readonly harnessId: string;
  readonly itemId: string;
};

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const item = await simAtShip(world, {
      harnessId: harness.id,
      editor: admin,
      title: 'Show the board',
      change: standardChange,
    });
    const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', standardChange.head, 9300000002)];
    world.adapters.githubFacts.given(
      greenFacts(world, { itemId: item.itemId, head: standardChange.head, reviews }),
    );
    await work({ world, admin, harnessId: harness.id, itemId: item.itemId });
  } finally {
    await world.close();
  }
}

function claim(scene: Scene, loan: MergeLoan) {
  return scene.world.kernel.items.claim(simCaller(scene.world, loan.agent), {
    itemId: scene.itemId,
    delegationId: loan.delegationId,
  });
}

function submit(scene: Scene, agent: Principal) {
  const input = { itemId: scene.itemId, to: null, evidence: {}, change: null };
  return scene.world.kernel.items.submit(simCaller(scene.world, agent), input);
}

function rows(scene: Scene) {
  return scene.world.adapters.store.transaction((tx) =>
    tx.gateDecisions.read.forItem(scene.itemId),
  );
}

function lend(scene: Scene, persona: string): Promise<MergeLoan> {
  return simLendMerge(scene.world, scene.admin, {
    harnessId: scene.harnessId,
    maxTier: 'standard',
    persona,
  });
}

type Held = { readonly connectors: Connectors; readonly running: Promise<void>; free(): void };

function heldConnectors(scene: Scene): Held {
  let started: () => void = () => undefined;
  let free: () => void = () => undefined;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const freed = new Promise<void>((resolve) => {
    free = resolve;
  });
  const connectors: Connectors = {
    run: async (request) => {
      started();
      await freed;
      return scene.world.adapters.connectors.run(request);
    },
    outcomeOf: (request) => scene.world.adapters.connectors.outcomeOf(request),
    review: () => notWiredCall('connectors', 'review'),
  };
  return { connectors, running, free };
}

async function parkByPerson(scene: Scene): Promise<void> {
  const person = simCaller(scene.world, scene.admin);
  const { items } = scene.world.kernel;
  expect((await items.claim(person, { itemId: scene.itemId, delegationId: null })).status).toBe(
    'accepted',
  );
  expect((await submit(scene, scene.admin)).status).toBe('accepted');
}

async function personInFlight(scene: Scene): Promise<void> {
  await parkByPerson(scene);
  const held = heldConnectors(scene);
  const kernel = createKernel({ ...scene.world.adapters, connectors: held.connectors });
  const approving = kernel.gates.decide(simCaller(scene.world, scene.admin), {
    itemId: scene.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: await simSeenHead(scene.world, scene.itemId),
  });
  await held.running;
  const loan = await lend(scene, 'shipper');
  const refusal = { status: 'error', reason: 'decision_in_flight' };
  expect(await claim(scene, loan)).toMatchObject(refusal);
  expect(await submit(scene, loan.agent)).toMatchObject(refusal);
  held.free();
  expect(await approving).toMatchObject({ status: 'accepted', value: { advanced: true } });
  expect(await rows(scene)).toMatchObject([{ actor: scene.admin.identity, agentActor: null }]);
}

async function delegatedInFlight(scene: Scene): Promise<void> {
  const first = await lend(scene, 'shipper');
  expect((await claim(scene, first)).status).toBe('accepted');
  expect(await submit(scene, first.agent)).toMatchObject({
    status: 'accepted',
    value: { result: 'parked', failures: [] },
  });
  const refusal = { status: 'error', reason: 'decision_in_flight' };
  expect(await submit(scene, first.agent)).toMatchObject(refusal);
  const second = await lend(scene, 'second-shipper');
  expect(await claim(scene, second)).toMatchObject(refusal);
  expect(await submit(scene, second.agent)).toMatchObject(refusal);
  expect(await rows(scene)).toMatchObject([{ agentActor: first.agent.identity }]);
}

describe('MD-3 no agent takes the Ship exit while a decision on it is in flight', () => {
  it('MD-3 a person approval whose merge is running refuses an agent claim and submit decision_in_flight, and writes one row', () =>
    inScene(personInFlight));

  it('MD-3 a delegated decision waiting for its merge refuses a retried submit and another agent decision_in_flight, and writes one row', () =>
    inScene(delegatedInFlight));
});
