import type { DraftStage, Harness, HarnessEvent } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { checkOnly, readAllEvents, type Caller, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;
const minute = 60_000;

type Scene = {
  readonly world: World;
  readonly harness: Harness;
  readonly rowan: Caller;
  readonly ana: Caller;
  readonly member: Caller;
};

async function withScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, checkOnly);
    const ana = await simPerson(world, 2, [{ role: 'admin', ...area }]);
    const member = await simPerson(world, 3, [{ role: 'editor', ...area }]);
    await work({
      world,
      harness,
      rowan: simCaller(world, admin),
      ana: simCaller(world, ana),
      member: simCaller(world, member),
    });
  } finally {
    await world.close();
  }
}

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

const triage: DraftStage = {
  id: null,
  key: 'triage',
  title: 'Triage',
  bracket: 'product_package',
  agentPickup: 'allowed',
  exitGate: 'checks',
  connector: 'none',
  wipLimit: 2,
  instructionsPageId: null,
  validators: [],
  feeds: [],
};

const live = (scene: Scene) =>
  scene.world.adapters.store.transaction((tx) =>
    tx.harnessStages.read.forHarness(scene.harness.id),
  );

async function eventNames(scene: Scene): Promise<readonly string[]> {
  const events: readonly HarnessEvent[] = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harness.id, null),
  );
  return events.map((event) => event.name);
}

async function savedWithTriage(scene: Scene, caller: Caller = scene.rowan) {
  const harnessId = scene.harness.id;
  const opened = value(await scene.world.kernel.drafts.open(caller, { harnessId }));
  return value(
    await scene.world.kernel.drafts.save(caller, {
      harnessId,
      revision: opened.revision,
      stages: [triage, ...opened.stages],
    }),
  );
}

async function publishesTheWholeDraft(scene: Scene): Promise<void> {
  const before = await live(scene);
  const saved = await savedWithTriage(scene);
  expect(await live(scene)).toEqual(before);
  const harnessId = scene.harness.id;
  const published = value(
    await scene.world.kernel.drafts.publish(scene.rowan, {
      harnessId,
      revision: saved.revision,
    }),
  );
  expect(published.map((stage) => [stage.key, stage.position])).toEqual([
    ['triage', 10],
    ['check', 20],
    ['ship', 30],
  ]);
  expect((await live(scene)).map((stage) => stage.key)).toEqual(['triage', 'check', 'ship']);
  expect(await eventNames(scene)).toEqual(
    expect.arrayContaining([
      'workflow_draft_opened',
      'workflow_draft_saved',
      'stage_edited',
      'workflow_published',
    ]),
  );
  const view = value(await scene.world.kernel.views.workflowDraft(scene.rowan, { harnessId }));
  expect(view).toBeNull();
}

async function recordsThePublish(scene: Scene): Promise<void> {
  const saved = await savedWithTriage(scene);
  value(
    await scene.world.kernel.drafts.publish(scene.rowan, {
      harnessId: scene.harness.id,
      revision: saved.revision,
    }),
  );
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harness.id, null),
  );
  const published = events.find((event) => event.name === 'workflow_published');
  expect(published?.actor).toBe(scene.rowan.actor.identity);
  expect(published?.evidence).toEqual({
    added: ['triage'],
    removed: [],
    changed: [],
    reordered: false,
  });
}

async function refusesAProblemDraft(scene: Scene): Promise<void> {
  const harnessId = scene.harness.id;
  const opened = value(await scene.world.kernel.drafts.open(scene.rowan, { harnessId }));
  const broken = opened.stages.map((stage) =>
    stage.key === 'ship' ? { ...stage, exitGate: 'checks' as const } : stage,
  );
  const saved = value(
    await scene.world.kernel.drafts.save(scene.rowan, {
      harnessId,
      revision: opened.revision,
      stages: [...broken, { ...triage, feeds: ['gone'] }],
    }),
  );
  const view = value(await scene.world.kernel.views.workflowDraft(scene.rowan, { harnessId }));
  expect(view?.problems.map((entry) => [entry.stage, entry.code])).toEqual([
    ['ship', 'connector_needs_person'],
    ['triage', 'unknown_loop_target'],
  ]);
  const refused = await scene.world.kernel.drafts.publish(scene.rowan, {
    harnessId,
    revision: saved.revision,
  });
  expect(refused).toMatchObject({ status: 'error', reason: 'draft_has_problems' });
}

async function flagsAHoldingStage(scene: Scene): Promise<void> {
  const harnessId = scene.harness.id;
  value(
    await scene.world.kernel.items.enqueue(scene.rowan, {
      harnessId,
      title: 'Sits in check',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
  );
  const opened = value(await scene.world.kernel.drafts.open(scene.rowan, { harnessId }));
  value(
    await scene.world.kernel.drafts.save(scene.rowan, {
      harnessId,
      revision: opened.revision,
      stages: opened.stages.filter((stage) => stage.key !== 'check'),
    }),
  );
  const view = value(await scene.world.kernel.views.workflowDraft(scene.rowan, { harnessId }));
  expect(view?.problems.map((entry) => [entry.stage, entry.code])).toEqual([
    ['check', 'stage_holds_items'],
  ]);
}

async function publishesChangesAndOrder(scene: Scene): Promise<void> {
  const harnessId = scene.harness.id;
  const opened = value(await scene.world.kernel.drafts.open(scene.rowan, { harnessId }));
  const [check, ship] = opened.stages;
  if (check === undefined || ship === undefined) throw new Error('expected two stages');
  const saved = value(
    await scene.world.kernel.drafts.save(scene.rowan, {
      harnessId,
      revision: opened.revision,
      stages: [
        { ...ship, feeds: ['check'] },
        { ...check, title: 'Verify' },
      ],
    }),
  );
  value(
    await scene.world.kernel.drafts.publish(scene.rowan, {
      harnessId,
      revision: saved.revision,
    }),
  );
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, harnessId, null),
  );
  expect(events.find((event) => event.name === 'workflow_published')?.evidence).toEqual({
    added: [],
    removed: [],
    changed: ['ship', 'check'],
    reordered: true,
  });
  expect((await live(scene)).map((stage) => [stage.key, stage.title])).toEqual([
    ['ship', 'Merge'],
    ['check', 'Verify'],
  ]);
}

async function lockPassesWhenIdle(scene: Scene): Promise<void> {
  const harnessId = scene.harness.id;
  await savedWithTriage(scene);
  const locked = await scene.world.kernel.drafts.open(scene.ana, { harnessId });
  expect(locked).toMatchObject({ status: 'error', reason: 'draft_locked' });
  const save = await scene.world.kernel.drafts.save(scene.ana, {
    harnessId,
    revision: 2,
    stages: [],
  });
  expect(save).toMatchObject({ status: 'error', reason: 'draft_locked' });
  scene.world.adapters.clock.advance(30 * minute);
  const passed = value(await scene.world.kernel.drafts.open(scene.ana, { harnessId }));
  expect(passed.stages.map((stage) => stage.key)).toEqual(['triage', 'check', 'ship']);
  expect(await eventNames(scene)).toContain('workflow_draft_taken_over');
}

async function takesOverWithAReason(scene: Scene): Promise<void> {
  const harnessId = scene.harness.id;
  await savedWithTriage(scene);
  const seen = value(await scene.world.kernel.views.workflowDraft(scene.ana, { harnessId }));
  expect(seen).toMatchObject({ mine: false, lockActive: true, admin: true });
  expect(seen?.holder.personId).toBe(scene.rowan.actor.personId);
  const taken = value(
    await scene.world.kernel.drafts.takeOver(scene.ana, { harnessId, reason: 'Away today' }),
  );
  expect(taken.holderPersonId).toBe(scene.ana.actor.personId);
  expect(taken.stages.map((stage) => stage.key)).toEqual(['triage', 'check', 'ship']);
  const mine = await scene.world.kernel.drafts.save(scene.rowan, {
    harnessId,
    revision: taken.revision,
    stages: [],
  });
  expect(mine).toMatchObject({ status: 'error', reason: 'draft_locked' });
}

async function memberSeesOnlyTheHolder(scene: Scene): Promise<void> {
  const harnessId = scene.harness.id;
  await savedWithTriage(scene);
  const seen = value(await scene.world.kernel.views.workflowDraft(scene.member, { harnessId }));
  expect(seen).toMatchObject({ admin: false, stages: [], problems: [] });
}

async function discardsTheDraft(scene: Scene): Promise<void> {
  const before = await live(scene);
  await savedWithTriage(scene);
  value(await scene.world.kernel.drafts.discard(scene.rowan, { harnessId: scene.harness.id }));
  expect(await live(scene)).toEqual(before);
  expect(await eventNames(scene)).toContain('workflow_draft_discarded');
}

async function refusesAgentsAndMembers(scene: Scene): Promise<void> {
  const harnessId = scene.harness.id;
  const agent = simCaller(
    scene.world,
    simAgent(scene.rowan.actor, 'builder', { interactive: false }),
  );
  expect(await scene.world.kernel.drafts.open(agent, { harnessId })).toMatchObject({
    reason: 'not_permitted',
  });
  expect(await scene.world.kernel.drafts.open(scene.member, { harnessId })).toMatchObject({
    reason: 'not_permitted',
  });
}

async function refusesStaleWork(scene: Scene): Promise<void> {
  const harnessId = scene.harness.id;
  const saved = await savedWithTriage(scene);
  const stale = await scene.world.kernel.drafts.save(scene.rowan, {
    harnessId,
    revision: saved.revision - 1,
    stages: saved.stages,
  });
  expect(stale).toMatchObject({ reason: 'draft_revision_mismatch' });
  value(
    await scene.world.kernel.stages.updateStage(scene.rowan, {
      harnessId,
      stageKey: 'check',
      change: { wipLimit: 5 },
    }),
  );
  const publish = await scene.world.kernel.drafts.publish(scene.rowan, {
    harnessId,
    revision: saved.revision,
  });
  expect(publish).toMatchObject({ reason: 'draft_stale' });
}

async function refusesARenamedKey(scene: Scene): Promise<void> {
  const harnessId = scene.harness.id;
  const opened = value(await scene.world.kernel.drafts.open(scene.rowan, { harnessId }));
  const renamed = opened.stages.map((stage) =>
    stage.key === 'check' ? { ...stage, key: 'verify' } : stage,
  );
  const save = await scene.world.kernel.drafts.save(scene.rowan, {
    harnessId,
    revision: opened.revision,
    stages: renamed,
  });
  expect(save).toMatchObject({ reason: 'malformed_command' });
}

describe('#103 a workflow is edited as a draft and published as one change', () => {
  it('keeps the live workflow unchanged until publish, then applies the whole draft', () =>
    withScene(publishesTheWholeDraft));

  it('records what was added, removed and changed, and who published', () =>
    withScene(recordsThePublish));

  it('refuses to publish while the check finds a problem, and names it on its stage', () =>
    withScene(refusesAProblemDraft));
});

describe('#103 the check reads what the live workflow holds', () => {
  it('flags removing a stage that still holds an item', () => withScene(flagsAHoldingStage));

  it('publishes a renamed title and a new order as changed and reordered', () =>
    withScene(publishesChangesAndOrder));
});

describe('#103 the editing lock', () => {
  it('refuses a second admin while the lock is held, and passes the draft on after 30 idle minutes', () =>
    withScene(lockPassesWhenIdle));

  it('lets a second admin see who is editing, and take over with a reason that keeps the changes', () =>
    withScene(takesOverWithAReason));

  it('shows a team member who is editing, but not the draft itself', () =>
    withScene(memberSeesOnlyTheHolder));
});

describe('#103 drafts refuse what they must', () => {
  it('discards a draft and leaves the live workflow as it was', () => withScene(discardsTheDraft));

  it('refuses an agent and a team member', () => withScene(refusesAgentsAndMembers));

  it('refuses a save from an old revision, and a publish once the live stages changed', () =>
    withScene(refusesStaleWork));

  it('refuses a save that renames an existing stage key', () => withScene(refusesARenamedKey));
});
