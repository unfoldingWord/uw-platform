import type { HarnessEvent, ItemState, Principal, Stage } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly admin: Caller;
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
    const { harness, admin } = await createSimHarness(world, software);
    const max = await simPerson(world, 6, [{ role: 'editor', ...area }]);
    await work({
      world,
      harnessId: harness.id,
      admin: simCaller(world, admin),
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

async function enqueueAt(scene: Scene, stageKey: string): Promise<string> {
  const { itemId } = value(
    await scene.world.kernel.items.enqueue(scene.editor, {
      harnessId: scene.harnessId,
      title: 'Wire the board',
      pageId: null,
      priority: 1,
      due: null,
    }),
  );
  await project(scene, itemId, (item) => ({ ...item, stageKey }));
  return itemId;
}

async function project(
  scene: Scene,
  itemId: string,
  change: (item: ItemState) => ItemState,
): Promise<void> {
  await scene.world.adapters.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.lock(itemId);
    if (item === null) throw new Error('item vanished');
    await tx.harnessItems.write.project(change(item));
  });
}

async function feed(scene: Scene, stageKey: string, feeds: readonly string[]): Promise<void> {
  value(
    await scene.world.kernel.stages.updateStage(scene.admin, {
      harnessId: scene.harnessId,
      stageKey,
      change: { feeds: [...feeds] },
    }),
  );
}

function submitTo(scene: Scene, caller: Caller, itemId: string, to: string | null) {
  return scene.world.kernel.items.submit(caller, { itemId, to, evidence: {}, change: null });
}

function eventsOf(scene: Scene, itemId: string | null): Promise<readonly HarnessEvent[]> {
  return scene.world.adapters.store.transaction((tx) => readAllEvents(tx, scene.harnessId, itemId));
}

function namesOf(events: readonly HarnessEvent[]): string[] {
  return events.map((event) => event.name);
}

async function setStage(scene: Scene, stageKey: string, change: Partial<Stage>): Promise<void> {
  value(
    await scene.world.kernel.stages.updateStage(scene.admin, {
      harnessId: scene.harnessId,
      stageKey,
      change,
    }),
  );
}

describe('KN-8 a transition to a stage that is neither next nor fed is refused', () => {
  sceneIt('refuses a stage that no edge reaches and writes no event', async (scene) => {
    await feed(scene, 'plan', ['scope']);
    const itemId = await enqueueAt(scene, 'plan');
    value(await scene.world.kernel.items.claim(scene.builder, { itemId, delegationId: null }));
    const before = namesOf(await eventsOf(scene, itemId));
    expect(reasonOf(await submitTo(scene, scene.builder, itemId, 'package'))).toBe(
      'transition_not_allowed',
    );
    expect(namesOf(await eventsOf(scene, itemId))).toEqual(before);
  });
});

describe('KN-8 a feeds edge re-enters an earlier stage', () => {
  sceneIt('takes a feeds edge and records loop_edge_taken on the same item', async (scene) => {
    await feed(scene, 'plan', ['scope']);
    const itemId = await enqueueAt(scene, 'plan');
    value(await scene.world.kernel.items.claim(scene.builder, { itemId, delegationId: null }));
    const looped = value(await submitTo(scene, scene.builder, itemId, 'scope'));
    expect(looped.item).toMatchObject({
      itemId,
      stageKey: 'scope',
      holder: null,
      gateStatus: 'working',
    });
    const names = namesOf(await eventsOf(scene, itemId));
    expect(names.slice(-3)).toEqual(['submitted_to_gate', 'checks_passed', 'loop_edge_taken']);
  });
});

describe('KN-8 an unattended traversal of a loop edge is refused without a delegation id', () => {
  sceneIt('refuses a non-interactive agent holding no delegation', async (scene) => {
    await feed(scene, 'plan', ['scope']);
    const itemId = await enqueueAt(scene, 'plan');
    const runner = `${scene.max.personId}/runner`;
    const bare = simCaller(scene.world, simAgent(scene.max, runner, { interactive: false }));
    await project(scene, itemId, (item) => ({
      ...item,
      holder: bare.actor.identity,
      claimantKind: 'agent',
      delegationId: null,
      leaseExpiresAt: new Date(scene.world.adapters.clock.now().getTime() + 60_000).toISOString(),
    }));
    const outcome = await submitTo(scene, bare, itemId, 'scope');
    expect(outcome).toMatchObject({
      status: 'error',
      reason: 'delegation_required',
      detail: { stage: 'plan' },
    });
    const names = namesOf(await eventsOf(scene, itemId));
    expect(names.slice(-1)).toEqual(['delegation_required']);
    expect((await stateOf(scene, itemId))?.stageKey).toBe('plan');
  });

  sceneIt(
    'accepts the same submit by an agent that claimed under a live delegation',
    async (scene) => {
      await feed(scene, 'plan', ['scope']);
      const kim = await simPerson(scene.world, 4, [{ role: 'admin', ...area }]);
      const delegation = value(
        await scene.world.kernel.delegations.grant(simCaller(scene.world, kim), {
          harnessId: scene.harnessId,
          persona: 'agent:iterate',
          capability: 'iterate',
          expiresAt: null,
          supersedes: null,
        }),
      );
      const bare = simCaller(scene.world, simAgent(kim, 'iterate', { interactive: false }));
      const itemId = await enqueueAt(scene, 'plan');
      value(await scene.world.kernel.items.claim(bare, { itemId, delegationId: delegation.id }));
      const looped = value(await submitTo(scene, bare, itemId, 'scope'));
      expect(looped.item.stageKey).toBe('scope');
      expect(namesOf(await eventsOf(scene, itemId))).toContain('loop_edge_taken');
    },
  );
});

function stateOf(scene: Scene, itemId: string): Promise<ItemState | null> {
  return scene.world.adapters.store.transaction((tx) => tx.harnessItems.read.byId(itemId));
}

describe('KN-8 a feeds target that is also the next stage is a forward exit', () => {
  sceneIt('records stage_advanced and not loop_edge_taken', async (scene) => {
    await feed(scene, 'scope', ['plan']);
    const itemId = await enqueueAt(scene, 'scope');
    value(await scene.world.kernel.items.claim(scene.builder, { itemId, delegationId: null }));
    value(await submitTo(scene, scene.builder, itemId, 'plan'));
    const names = namesOf(await eventsOf(scene, itemId));
    expect(names).toContain('stage_advanced');
    expect(names).not.toContain('loop_edge_taken');
  });
});

describe('KN-8 the occasional tweak to the first stage parks for a person', () => {
  sceneIt('parks a none exit with gateTarget set and the item still in place', async (scene) => {
    await feed(scene, 'plan', ['package']);
    await setStage(scene, 'plan', { exitGate: 'none' });
    const itemId = await enqueueAt(scene, 'plan');
    value(await scene.world.kernel.items.claim(scene.builder, { itemId, delegationId: null }));
    const parked = value(await submitTo(scene, scene.builder, itemId, 'package'));
    expect(parked.result).toBe('parked');
    expect(parked.item).toMatchObject({
      stageKey: 'plan',
      gateStatus: 'parked',
      gateTarget: 'package',
    });
    const names = namesOf(await eventsOf(scene, itemId));
    expect(names.slice(-1)).toEqual(['submitted_to_gate']);
  });

  sceneIt('parks a passing checks exit after checks_passed', async (scene) => {
    await feed(scene, 'plan', ['package']);
    const itemId = await enqueueAt(scene, 'plan');
    value(await scene.world.kernel.items.claim(scene.builder, { itemId, delegationId: null }));
    const parked = value(await submitTo(scene, scene.builder, itemId, 'package'));
    expect(parked.item).toMatchObject({ stageKey: 'plan', gateTarget: 'package' });
    const names = namesOf(await eventsOf(scene, itemId));
    expect(names.slice(-2)).toEqual(['submitted_to_gate', 'checks_passed']);
    expect(names).not.toContain('loop_edge_taken');
  });
});

describe('KN-8 the occasional tweak follows the bracket, not the position', () => {
  sceneIt('still parks after the stages are reordered so Package is not first', async (scene) => {
    await feed(scene, 'plan', ['package', 'scope']);
    value(
      await scene.world.kernel.stages.reorderStages(scene.admin, {
        harnessId: scene.harnessId,
        order: ['scope', 'package', 'plan', 'build', 'check', 'ship', 'validate', 'close'],
      }),
    );
    const itemId = await enqueueAt(scene, 'plan');
    value(await scene.world.kernel.items.claim(scene.builder, { itemId, delegationId: null }));
    const parked = value(await submitTo(scene, scene.builder, itemId, 'package'));
    expect(parked.item).toMatchObject({ stageKey: 'plan', gateTarget: 'package' });
    const next = await enqueueAt(scene, 'plan');
    value(
      await scene.world.kernel.items.claim(scene.builder, { itemId: next, delegationId: null }),
    );
    const looped = value(await submitTo(scene, scene.builder, next, 'scope'));
    expect(looped.result).toBe('advanced');
    expect(looped.item).toMatchObject({ stageKey: 'scope', gateTarget: null });
  });

  sceneIt('does not park a loop into a stage that is not product_package', async (scene) => {
    await feed(scene, 'build', ['plan']);
    const itemId = await enqueueAt(scene, 'build');
    value(await scene.world.kernel.items.claim(scene.builder, { itemId, delegationId: null }));
    const looped = value(await submitTo(scene, scene.builder, itemId, 'plan'));
    expect(looped.result).toBe('advanced');
    expect(looped.item.gateTarget).toBeNull();
  });
});

describe('KN-8 the occasional tweak is held by checks and by who may traverse it', () => {
  sceneIt('fails the checks and does not park when a validator fails', async (scene) => {
    await feed(scene, 'plan', ['package']);
    await setStage(scene, 'plan', { validators: ['learning_attached'] });
    const itemId = await enqueueAt(scene, 'plan');
    value(await scene.world.kernel.items.claim(scene.builder, { itemId, delegationId: null }));
    const failed = value(await submitTo(scene, scene.builder, itemId, 'package'));
    expect(failed.result).toBe('checks_failed');
    expect(failed.item).toMatchObject({ stageKey: 'plan', gateTarget: null });
    expect(namesOf(await eventsOf(scene, itemId)).slice(-2)).toEqual([
      'submitted_to_gate',
      'checks_failed',
    ]);
  });

  sceneIt('parks a loop out of a human_approval stage with its target', async (scene) => {
    await feed(scene, 'ship', ['package']);
    const itemId = await enqueueAt(scene, 'ship');
    value(await scene.world.kernel.items.claim(scene.editor, { itemId, delegationId: null }));
    const parked = value(await submitTo(scene, scene.editor, itemId, 'package'));
    expect(parked.result).toBe('parked');
    expect(parked.item).toMatchObject({ stageKey: 'ship', gateTarget: 'package' });
  });

  sceneIt(
    'refuses an unattended agent attempting the tweak without a delegation',
    async (scene) => {
      await feed(scene, 'plan', ['package']);
      const itemId = await enqueueAt(scene, 'plan');
      const runner = `${scene.max.personId}/runner`;
      const bare = simCaller(scene.world, simAgent(scene.max, runner, { interactive: false }));
      await project(scene, itemId, (item) => ({
        ...item,
        holder: bare.actor.identity,
        claimantKind: 'agent',
        delegationId: null,
        leaseExpiresAt: new Date(scene.world.adapters.clock.now().getTime() + 60_000).toISOString(),
      }));
      expect(reasonOf(await submitTo(scene, bare, itemId, 'package'))).toBe('delegation_required');
      expect((await stateOf(scene, itemId))?.gateTarget).toBeNull();
    },
  );
});
