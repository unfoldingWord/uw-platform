import {
  newEventSchema,
  type HarnessEvent,
  type ItemState,
  type Principal,
  type Stage,
} from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { revokeSeededGrant } from '@uw/db/test-seed';
import { LEASE_MS, readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createSimHarness,
  readSpend,
  simAgent,
  simCaller,
  simDelegate,
  simIan,
  simPerson,
  simSystem,
} from '../fixtures.ts';
import { simSha } from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly admin: Caller;
  readonly kim: Principal;
  readonly max: Principal;
  readonly editor: Caller;
  readonly builder: Caller;
};

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function reasonOf(outcome: KernelOutcome<unknown>): string | null {
  return outcome.status === 'error' ? outcome.reason : null;
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness } = await createSimHarness(world, software);
    await readSpend(world);
    const kim = await simPerson(world, 4, [{ role: 'admin', ...area }]);
    const max = await simPerson(world, 6, [{ role: 'editor', ...area }]);
    await work({
      world,
      harnessId: harness.id,
      admin: simCaller(world, await simIan(world)),
      kim,
      max,
      editor: simCaller(world, max),
      builder: simCaller(world, simAgent(max, `${max.personId}/builder`, { interactive: true })),
    });
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

async function enqueueAt(scene: Scene, stageKey: string, title: string): Promise<string> {
  const { itemId } = value(
    await scene.world.kernel.items.enqueue(scene.editor, {
      harnessId: scene.harnessId,
      title,
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
  );
  await scene.world.adapters.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.lock(itemId);
    if (item === null) throw new Error('item vanished');
    await tx.harnessItems.write.project({ ...item, stageKey });
  });
  return itemId;
}

function claimAs(scene: Scene, caller: Caller, itemId: string) {
  return scene.world.kernel.items.claim(caller, { itemId, delegationId: null });
}

function submitAs(scene: Scene, caller: Caller, itemId: string, change: ItemChange = null) {
  return scene.world.kernel.items.submit(caller, { itemId, to: null, evidence: {}, change });
}

type ItemChange = Parameters<Scene['world']['kernel']['items']['submit']>[1]['change'];

const change = (head: string): ItemChange => ({
  pullRequest: { repo: 'unfoldingWord/uw-platform', number: 7 },
  head,
});

function eventsOf(scene: Scene, itemId: string | null): Promise<readonly HarnessEvent[]> {
  return scene.world.adapters.store.transaction((tx) => readAllEvents(tx, scene.harnessId, itemId));
}

function stateOf(scene: Scene, itemId: string): Promise<ItemState | null> {
  return scene.world.adapters.store.transaction((tx) => tx.harnessItems.read.byId(itemId));
}

function setValidators(scene: Scene, stageKey: string, validators: readonly string[]) {
  return scene.world.adapters.store.transaction(async (tx) => {
    const stages: readonly Stage[] = await tx.harnessStages.read.forHarness(scene.harnessId);
    const stage = stages.find((entry) => entry.key === stageKey);
    if (stage === undefined) throw new Error(`no stage ${stageKey}`);
    await tx.harnessStages.write.update({ ...stage, validators: [...validators] });
  });
}

describe('submit refuses a caller who may not submit', () => {
  sceneIt('refuses a non-holder editor with not_holder', async (scene) => {
    const itemId = await enqueueAt(scene, 'package', 'Wire the board');
    value(await claimAs(scene, scene.editor, itemId));
    const other = simCaller(
      scene.world,
      await simPerson(scene.world, 7, [{ role: 'editor', ...area }]),
    );
    expect(reasonOf(await submitAs(scene, other, itemId))).toBe('not_holder');
  });

  sceneIt('refuses a viewer with not_permitted', async (scene) => {
    const itemId = await enqueueAt(scene, 'package', 'Wire the board');
    const viewer = simCaller(
      scene.world,
      await simPerson(scene.world, 8, [{ role: 'viewer', ...area }]),
    );
    expect(reasonOf(await submitAs(scene, viewer, itemId))).toBe('not_permitted');
  });

  sceneIt('refuses an unknown item', async (scene) => {
    const outcome = await submitAs(scene, scene.editor, scene.world.adapters.ids.next());
    expect(reasonOf(outcome)).toBe('item_not_found');
  });

  sceneIt('refuses a destination that is not the next stage', async (scene) => {
    const itemId = await enqueueAt(scene, 'scope', 'Wire the board');
    value(await claimAs(scene, scene.builder, itemId));
    const outcome = await scene.world.kernel.items.submit(scene.builder, {
      itemId,
      to: 'close',
      evidence: {},
      change: null,
    });
    expect(outcome).toMatchObject({
      status: 'error',
      reason: 'transition_not_allowed',
      detail: { from: 'scope', to: 'close' },
    });
  });
});

describe('KN-6 an unknown validator key fails closed with the key in the failure', () => {
  sceneIt('returns checks_failed naming the retired key', async (scene) => {
    await setValidators(scene, 'scope', ['retired_check']);
    const itemId = await enqueueAt(scene, 'scope', 'Wire the board');
    value(await claimAs(scene, scene.builder, itemId));
    const submitted = value(await submitAs(scene, scene.builder, itemId));
    expect(submitted.result).toBe('checks_failed');
    expect(submitted.failures).toEqual(['unknown_validator: retired_check']);
    expect(submitted.item.stageKey).toBe('scope');
    const names = (await eventsOf(scene, itemId)).map((event) => event.name);
    expect(names.slice(-2)).toEqual(['submitted_to_gate', 'checks_failed']);
  });
});

describe('KN-6 the last stage closes the item', () => {
  sceneIt('ends done when the validator passes', async (scene) => {
    const itemId = await enqueueAt(scene, 'close', 'Wire the board');
    await scene.world.adapters.store.transaction((tx) =>
      tx.harnessEvents.write.append([
        newEventSchema.parse({
          eventId: scene.world.adapters.ids.next(),
          harnessId: scene.harnessId,
          itemId,
          name: 'nothing_learned',
          at: scene.world.adapters.clock.now().toISOString(),
          actor: scene.max.identity,
          evidence: { reason: 'nothing surprising' },
          traceId: scene.world.adapters.ids.next(),
          requestId: null,
        }),
      ]),
    );
    value(await claimAs(scene, scene.editor, itemId));
    const submitted = value(await submitAs(scene, scene.editor, itemId));
    expect(submitted.result).toBe('advanced');
    expect(submitted.item.gateStatus).toBe('done');
    expect(submitted.item.holder).toBeNull();
    const names = (await eventsOf(scene, itemId)).map((event) => event.name);
    expect(names.slice(-3)).toEqual(['submitted_to_gate', 'checks_passed', 'stage_advanced']);
  });
});

describe('GH-4 a submit records the expected head and a later submit replaces it', () => {
  sceneIt('sets expectedHead, pullRequest and an active branch', async (scene) => {
    await setValidators(scene, 'scope', ['learning_attached']);
    const itemId = await enqueueAt(scene, 'scope', 'Wire the board');
    value(await claimAs(scene, scene.builder, itemId));
    const first = value(await submitAs(scene, scene.builder, itemId, change(simSha('abc123'))));
    expect(first.item).toMatchObject({
      expectedHead: simSha('abc123'),
      branchState: 'active',
      pullRequest: { repo: 'unfoldingWord/uw-platform', number: 7 },
    });
    const second = value(await submitAs(scene, scene.builder, itemId, change(simSha('def456'))));
    expect(second.item.expectedHead).toBe(simSha('def456'));
    expect((await stateOf(scene, itemId))?.expectedHead).toBe(simSha('def456'));
  });
});

describe('GH-4 a lapsed lease abandons the active branch', () => {
  async function activeBranch(scene: Scene): Promise<string> {
    await setValidators(scene, 'scope', ['learning_attached']);
    const itemId = await enqueueAt(scene, 'scope', 'Wire the board');
    value(await claimAs(scene, scene.builder, itemId));
    value(await submitAs(scene, scene.builder, itemId, change(simSha('abc123'))));
    scene.world.adapters.clock.advance(LEASE_MS + 1);
    return itemId;
  }

  async function lastNames(scene: Scene, itemId: string): Promise<string[]> {
    return (await eventsOf(scene, itemId)).map((event) => event.name).slice(-2);
  }

  sceneIt('writes lease_expired then branch_abandoned when the sweep sees it', async (scene) => {
    const itemId = await activeBranch(scene);
    const swept = value(
      await scene.world.kernel.items.expireLeases(simCaller(scene.world, simSystem()), {
        limit: 10,
      }),
    );
    expect(swept.expired).toEqual([itemId]);
    expect(await lastNames(scene, itemId)).toEqual(['lease_expired', 'branch_abandoned']);
    expect((await stateOf(scene, itemId))?.branchState).toBe('abandoned');
  });

  sceneIt('writes them when a run step finds the lease lapsed', async (scene) => {
    const itemId = await activeBranch(scene);
    const step = await scene.world.kernel.items.recordRunStep(scene.builder, {
      itemId,
      runId: scene.world.adapters.ids.next(),
      step: 'read',
      tokensIn: 1,
      tokensOut: 1,
      costBasis: 'subscription',
    });
    expect(reasonOf(step)).toBe('lease_expired');
    expect(await lastNames(scene, itemId)).toEqual(['lease_expired', 'branch_abandoned']);
  });

  sceneIt('writes them once when a submit finds the lease lapsed', async (scene) => {
    const itemId = await activeBranch(scene);
    expect(reasonOf(await submitAs(scene, scene.builder, itemId))).toBe('lease_expired');
    expect(reasonOf(await submitAs(scene, scene.builder, itemId))).toBe('not_holder');
    expect(await lastNames(scene, itemId)).toEqual(['lease_expired', 'branch_abandoned']);
    const lapses = (await eventsOf(scene, itemId)).filter((e) => e.name === 'lease_expired');
    expect(lapses).toHaveLength(1);
  });
});

describe('KN-6 a human approval stage never advances from submit', () => {
  sceneIt('parks at Ship and records no gate target, whatever to says', async (scene) => {
    const itemId = await enqueueAt(scene, 'ship', 'Wire the board');
    value(await claimAs(scene, scene.editor, itemId));
    const submitted = value(
      await scene.world.kernel.items.submit(scene.editor, {
        itemId,
        to: 'validate',
        evidence: {},
        change: null,
      }),
    );
    expect(submitted.result).toBe('parked');
    expect(submitted.item).toMatchObject({
      stageKey: 'ship',
      gateStatus: 'parked',
      gateTarget: null,
      holder: null,
    });
    const names = (await eventsOf(scene, itemId)).map((event) => event.name);
    expect(names.slice(-1)).toEqual(['submitted_to_gate']);
  });

  sceneIt('refuses a destination that is not the next stage at Ship', async (scene) => {
    const itemId = await enqueueAt(scene, 'ship', 'Wire the board');
    value(await claimAs(scene, scene.editor, itemId));
    const outcome = await scene.world.kernel.items.submit(scene.editor, {
      itemId,
      to: 'scope',
      evidence: {},
      change: null,
    });
    expect(reasonOf(outcome)).toBe('transition_not_allowed');
    expect((await stateOf(scene, itemId))?.gateStatus).toBe('working');
  });
});

describe('an advance releases the holder, so a full stage is not overfilled', () => {
  sceneIt('advances into a stage at its WIP limit holding nothing there', async (scene) => {
    await scene.world.kernel.stages.updateStage(scene.admin, {
      harnessId: scene.harnessId,
      stageKey: 'plan',
      change: { wipLimit: 1 },
    });
    const occupant = await enqueueAt(scene, 'plan', 'Occupant');
    value(await claimAs(scene, scene.builder, occupant));
    const mover = await enqueueAt(scene, 'scope', 'Mover');
    value(await claimAs(scene, scene.builder, mover));
    const submitted = value(await submitAs(scene, scene.builder, mover));
    expect(submitted.item).toMatchObject({ stageKey: 'plan', holder: null });
    const held = await scene.world.adapters.store.transaction((tx) =>
      tx.harnessItems.read.heldInStage(scene.harnessId, 'plan', scene.world.adapters.clock.now()),
    );
    expect(held).toBe(1);
  });
});

describe('KN-16 a submit under a delegation re-checks it', () => {
  sceneIt('refuses once the grant is revoked and writes one delegation_lapsed', async (scene) => {
    const delegation = value(
      await simDelegate(scene.world, scene.kim, {
        harnessId: scene.harnessId,
        persona: 'agent:builder',
        capability: 'build',
        expiresAt: null,
        supersedes: null,
      }),
    );
    const bare = simCaller(scene.world, simAgent(scene.kim, 'builder', { interactive: false }));
    const itemId = await enqueueAt(scene, 'scope', 'Wire the board');
    value(await scene.world.kernel.items.claim(bare, { itemId, delegationId: delegation.id }));
    const adminGrant = scene.kim.grants[0];
    if (adminGrant === undefined) throw new Error('kim has no grant');
    await revokeSeededGrant(
      scene.world.database.db,
      adminGrant.grantId,
      scene.world.adapters.clock.now(),
    );
    expect(reasonOf(await submitAs(scene, bare, itemId))).toBe('delegation_lapsed');
    expect(reasonOf(await submitAs(scene, bare, itemId))).toBe('delegation_lapsed');
    const lapses = (await eventsOf(scene, null)).filter((e) => e.name === 'delegation_lapsed');
    expect(lapses).toHaveLength(1);
    expect((await stateOf(scene, itemId))?.stageKey).toBe('scope');
  });
});
